#!/usr/bin/env ruby
# frozen_string_literal: true

# ==============================================================================
# OmniComment Standalone Ruby Server
#
# Zero-dependency HTTP REST API server using Ruby standard library (WEBrick).
# Implements full OmniComment persistence contract with thread-safe storage.
#
# Usage:
#   ruby server.rb
#   PORT=8000 ruby server.rb
# ==============================================================================

require 'webrick'
require 'json'
require 'securerandom'
require 'time'

PORT = (ENV['PORT'] || 8000).to_i
DATA_PATH = ENV['OMNICOMMENT_DATA_PATH'] || File.join(__dir__, 'comments.json')

# ------------------------------------------------------------------------------
# Concurrency-Safe Persistent Storage (HC001, HC004)
# ------------------------------------------------------------------------------

# Invariant: File writes must be atomic via temporary file swap to avoid corrupted JSON.
# Why: Prevents data corruption during concurrent writes or process termination.
# Example: Serializes @data to comments.json.tmp then atomic rename to comments.json.
class StorageEngine
  def initialize(file_path)
    @file_path = file_path
    @mutex = Mutex.new
    @data = {}
    load_from_disk
  end

  def list_comments(doc_id, include_resolved: true, sort: 'asc')
    @mutex.synchronize do
      comments = (@data[doc_id] || {}).values
      comments = comments.reject { |c| c['resolved'] } unless include_resolved
      comments.sort_by! { |c| c['createdAt'] || '' }
      comments.reverse! if sort == 'desc'
      comments
    end
  end

  def get_comment(doc_id, comment_id)
    @mutex.synchronize do
      @data.dig(doc_id, comment_id)
    end
  end

  def create_comment(doc_id, comment)
    @mutex.synchronize do
      @data[doc_id] ||= {}
      @data[doc_id][comment['id']] = comment
      save_to_disk
      comment
    end
  end

  def update_comment(doc_id, comment_id, patch)
    @mutex.synchronize do
      comment = @data.dig(doc_id, comment_id)
      return nil unless comment

      comment['content'] = patch['content'] if patch.key?('content')
      comment['resolved'] = patch['resolved'] if patch.key?('resolved')
      comment['orphaned'] = patch['orphaned'] if patch.key?('orphaned')
      comment['thumbsUp'] = patch['thumbsUp'] if patch.key?('thumbsUp')
      comment['updatedAt'] = Time.now.utc.iso8601

      save_to_disk
      comment
    end
  end

  def add_reply(doc_id, comment_id, reply)
    @mutex.synchronize do
      comment = @data.dig(doc_id, comment_id)
      return nil unless comment

      comment['replies'] ||= []
      comment['replies'] << reply
      comment['updatedAt'] = Time.now.utc.iso8601

      save_to_disk
      reply
    end
  end

  def delete_comment(doc_id, comment_id)
    @mutex.synchronize do
      return false unless @data[doc_id]&.key?(comment_id)

      @data[doc_id].delete(comment_id)
      save_to_disk
      true
    end
  end

  private

  def load_from_disk
    return unless File.exist?(@file_path)

    raw = File.read(@file_path)
    @data = JSON.parse(raw) unless raw.strip.empty?
  rescue StandardError => e
    warn "Warning: Failed to load #{@file_path}: #{e.message}. Using empty store."
    @data = {}
  end

  def save_to_disk
    tmp_file = "#{@file_path}.tmp"
    File.write(tmp_file, JSON.pretty_generate(@data))
    File.rename(tmp_file, @file_path)
  rescue StandardError => e
    warn "Error persisting comments to disk: #{e.message}"
  end
end

STORAGE = StorageEngine.new(DATA_PATH)

# ------------------------------------------------------------------------------
# Request Dispatcher Servlet (HC003)
# ------------------------------------------------------------------------------

class OmniCommentServlet < WEBrick::HTTPServlet::AbstractServlet
  def do_OPTIONS(req, res)
    set_cors_headers(res)
    res.status = 204
  end

  def do_GET(req, res)
    set_cors_headers(res)

    if req.path == '/health'
      json_response(res, 200, {
        status: 'ok',
        service: 'omnicomment-ruby-server',
        timestamp: Time.now.utc.iso8601
      })
      return
    end

    parsed = parse_route(req.path)
    unless parsed
      json_response(res, 404, { success: false, error: 'Endpoint not found' })
      return
    end

    doc_id, comment_id = parsed

    if comment_id.nil?
      # GET /api/documents/:docId/comments
      query = req.query || {}
      include_resolved = query['includeResolved'] != 'false'
      sort = query['sort'] == 'desc' ? 'desc' : 'asc'

      comments = STORAGE.list_comments(doc_id, include_resolved: include_resolved, sort: sort)
      json_response(res, 200, { success: true, count: comments.length, comments: comments })
    else
      # GET /api/documents/:docId/comments/:commentId
      comment = STORAGE.get_comment(doc_id, comment_id)
      if comment
        json_response(res, 200, { success: true, comment: comment })
      else
        json_response(res, 404, { success: false, error: 'Comment not found' })
      end
    end
  end

  def do_POST(req, res)
    set_cors_headers(res)
    parsed = parse_route(req.path)

    unless parsed
      json_response(res, 404, { success: false, error: 'Endpoint not found' })
      return
    end

    doc_id, comment_id, is_reply = parsed
    payload = parse_json_body(req)

    unless payload
      json_response(res, 400, { success: false, error: 'Invalid JSON request body' })
      return
    end

    if is_reply
      # POST /api/documents/:docId/comments/:commentId/replies
      if payload['content'].to_s.strip.empty? || payload['author'].to_s.strip.empty?
        json_response(res, 400, { success: false, error: 'content and author are required' })
        return
      end

      now = Time.now.utc.iso8601
      reply = {
        'id' => payload['id'] || "reply-#{SecureRandom.hex(6)}",
        'content' => payload['content'],
        'author' => payload['author'],
        'createdAt' => now,
        'updatedAt' => now,
        'thumbsUp' => []
      }

      created_reply = STORAGE.add_reply(doc_id, comment_id, reply)
      if created_reply
        json_response(res, 201, { success: true, reply: created_reply })
      else
        json_response(res, 404, { success: false, error: 'Parent comment thread not found' })
      end
    else
      # POST /api/documents/:docId/comments
      unless valid_comment_payload?(payload)
        json_response(res, 400, { success: false, error: 'anchor, content, and author are required' })
        return
      end

      now = Time.now.utc.iso8601
      comment = {
        'id' => payload['id'] || "comment-#{SecureRandom.hex(6)}",
        'documentId' => doc_id,
        'anchor' => payload['anchor'],
        'content' => payload['content'],
        'author' => payload['author'],
        'createdAt' => now,
        'updatedAt' => now,
        'resolved' => false,
        'orphaned' => false,
        'thumbsUp' => [],
        'replies' => []
      }

      created_comment = STORAGE.create_comment(doc_id, comment)
      json_response(res, 201, { success: true, comment: created_comment })
    end
  end

  def do_PATCH(req, res)
    set_cors_headers(res)
    parsed = parse_route(req.path)

    unless parsed && parsed[1]
      json_response(res, 404, { success: false, error: 'Endpoint not found' })
      return
    end

    doc_id, comment_id = parsed
    patch = parse_json_body(req)

    unless patch
      json_response(res, 400, { success: false, error: 'Invalid JSON request body' })
      return
    end

    updated = STORAGE.update_comment(doc_id, comment_id, patch)
    if updated
      json_response(res, 200, { success: true, comment: updated })
    else
      json_response(res, 404, { success: false, error: 'Comment not found' })
    end
  end

  def do_DELETE(req, res)
    set_cors_headers(res)
    parsed = parse_route(req.path)

    unless parsed && parsed[1]
      json_response(res, 404, { success: false, error: 'Endpoint not found' })
      return
    end

    doc_id, comment_id = parsed
    success = STORAGE.delete_comment(doc_id, comment_id)

    if success
      json_response(res, 200, { success: true, message: "Comment #{comment_id} deleted successfully" })
    else
      json_response(res, 404, { success: false, error: 'Comment not found' })
    end
  end

  private

  # Returns [doc_id, comment_id, is_reply] or nil
  def parse_route(path)
    pattern = %r{\A/api/documents/([^/]+)/comments(?:/([^/]+)(?:/(replies))?)?\z}
    match = path.match(pattern)
    return nil unless match

    doc_id = URI.decode_www_form_component(match[1])
    comment_id = match[2] ? URI.decode_www_form_component(match[2]) : nil
    is_reply = match[3] == 'replies'

    [doc_id, comment_id, is_reply]
  end

  def parse_json_body(req)
    return {} if req.body.nil? || req.body.strip.empty?
    JSON.parse(req.body)
  rescue JSON::ParserError
    nil
  end

  def valid_comment_payload?(p)
    return false unless p.is_a?(Hash)
    return false if p['content'].to_s.strip.empty? || p['author'].to_s.strip.empty?

    anchor = p['anchor']
    return false unless anchor.is_a?(Hash)
    return false if anchor['text'].to_s.strip.empty?
    return false unless anchor['startLine'].is_a?(Integer) && anchor['startChar'].is_a?(Integer)

    true
  end

  def set_cors_headers(res)
    res['Access-Control-Allow-Origin'] = '*'
    res['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS'
    res['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With'
  end

  def json_response(res, status_code, body)
    res.status = status_code
    res['Content-Type'] = 'application/json; charset=utf-8'
    res.body = JSON.generate(body)
  end
end

# ------------------------------------------------------------------------------
# Server Entrypoint
# ------------------------------------------------------------------------------

server = WEBrick::HTTPServer.new(
  Port: PORT,
  Logger: WEBrick::Log.new($stdout, WEBrick::Log::INFO),
  AccessLog: []
)

server.mount '/', OmniCommentServlet

trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }

puts "OmniComment Ruby (WEBrick) server listening on http://localhost:#{PORT}"
server.start
