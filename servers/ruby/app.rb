# frozen_string_literal: true

require 'sinatra'
require 'json'
require 'time'
require 'securerandom'

set :port, ENV['PORT'] || 8000
set :bind, '0.0.0.0'
set :default_content_type, 'application/json'

DATA_FILE = ENV['OMNICOMMENT_DATA_PATH'] || File.join(__dir__, 'comments.json')

# ------------------------------------------------------------------------------
# Storage Engine Helpers
# ------------------------------------------------------------------------------

def load_data
  return {} unless File.exist?(DATA_FILE)

  raw = File.read(DATA_FILE)
  raw.strip.empty? ? {} : JSON.parse(raw)
rescue StandardError
  {}
end

def save_data(data)
  tmp = "#{DATA_FILE}.tmp"
  File.write(tmp, JSON.pretty_generate(data))
  File.rename(tmp, DATA_FILE)
end

# ------------------------------------------------------------------------------
# CORS Middleware
# ------------------------------------------------------------------------------

before do
  response.headers['Access-Control-Allow-Origin'] = '*'
  response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS'
  response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With'
end

options '*' do
  204
end

# ------------------------------------------------------------------------------
# REST API Endpoints
# ------------------------------------------------------------------------------

get '/health' do
  { status: 'ok', service: 'omnicomment-ruby-sinatra', timestamp: Time.now.utc.iso8601 }.to_json
end

get '/api/documents/:doc_id/comments' do
  doc_id = params['doc_id']
  include_resolved = params['includeResolved'] != 'false'
  sort = params['sort'] == 'desc' ? 'desc' : 'asc'

  data = load_data
  comments = (data[doc_id] || {}).values
  comments = comments.reject { |c| c['resolved'] } unless include_resolved
  comments.sort_by! { |c| c['createdAt'] || '' }
  comments.reverse! if sort == 'desc'

  { success: true, count: comments.length, comments: comments }.to_json
end

get '/api/documents/:doc_id/comments/:comment_id' do
  doc_id = params['doc_id']
  comment_id = params['comment_id']

  data = load_data
  comment = data.dig(doc_id, comment_id)
  halt 404, { success: false, error: 'Comment not found' }.to_json unless comment

  { success: true, comment: comment }.to_json
end

post '/api/documents/:doc_id/comments' do
  doc_id = params['doc_id']
  payload = JSON.parse(request.body.read) rescue {}

  if payload['content'].to_s.strip.empty? || payload['author'].to_s.strip.empty? || !payload['anchor'].is_a?(Hash)
    halt 400, { success: false, error: 'content, author, and anchor are required' }.to_json
  end

  now = Time.now.utc.iso8601
  comment_id = payload['id'] || "comment-#{SecureRandom.hex(6)}"

  comment = {
    'id' => comment_id,
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

  data = load_data
  data[doc_id] ||= {}
  data[doc_id][comment_id] = comment
  save_data(data)

  status 201
  { success: true, comment: comment }.to_json
end

patch '/api/documents/:doc_id/comments/:comment_id' do
  doc_id = params['doc_id']
  comment_id = params['comment_id']
  patch = JSON.parse(request.body.read) rescue {}

  data = load_data
  comment = data.dig(doc_id, comment_id)
  halt 404, { success: false, error: 'Comment not found' }.to_json unless comment

  comment['content'] = patch['content'] if patch.key?('content')
  comment['resolved'] = patch['resolved'] if patch.key?('resolved')
  comment['orphaned'] = patch['orphaned'] if patch.key?('orphaned')
  comment['thumbsUp'] = patch['thumbsUp'] if patch.key?('thumbsUp')
  comment['updatedAt'] = Time.now.utc.iso8601

  save_data(data)
  { success: true, comment: comment }.to_json
end

post '/api/documents/:doc_id/comments/:comment_id/replies' do
  doc_id = params['doc_id']
  comment_id = params['comment_id']
  payload = JSON.parse(request.body.read) rescue {}

  if payload['content'].to_s.strip.empty? || payload['author'].to_s.strip.empty?
    halt 400, { success: false, error: 'content and author are required' }.to_json
  end

  data = load_data
  comment = data.dig(doc_id, comment_id)
  halt 404, { success: false, error: 'Parent comment thread not found' }.to_json unless comment

  now = Time.now.utc.iso8601
  reply = {
    'id' => payload['id'] || "reply-#{SecureRandom.hex(6)}",
    'content' => payload['content'],
    'author' => payload['author'],
    'createdAt' => now,
    'updatedAt' => now,
    'thumbsUp' => []
  }

  comment['replies'] ||= []
  comment['replies'] << reply
  comment['updatedAt'] = now
  save_data(data)

  status 201
  { success: true, reply: reply }.to_json
end

delete '/api/documents/:doc_id/comments/:comment_id' do
  doc_id = params['doc_id']
  comment_id = params['comment_id']

  data = load_data
  halt 404, { success: false, error: 'Comment not found' }.to_json unless data[doc_id]&.key?(comment_id)

  data[doc_id].delete(comment_id)
  save_data(data)

  { success: true, message: "Comment #{comment_id} deleted successfully" }.to_json
end
