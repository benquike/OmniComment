# frozen_string_literal: true

# ==============================================================================
# OmniComment Ruby on Rails Controller (Rails 7 & 8 Compatible)
#
# Drop-in API controller for Ruby on Rails applications.
#
# Route Configuration (config/routes.rb):
#
#   namespace :api do
#     resources :documents, only: [] do
#       resources :comments, only: [:index, :show, :create, :update, :destroy] do
#         post :replies, on: :member, to: 'comments#add_reply'
#       end
#     end
#   end
# ==============================================================================

class Api::CommentsController < ApplicationController
  skip_before_action :verify_authenticity_token, if: :json_request?
  before_action :set_document_id
  before_action :set_comment, only: [:show, :update, :destroy, :add_reply]

  # GET /api/documents/:document_id/comments
  def index
    scope = Comment.where(document_id: @document_id)
    scope = scope.where(resolved: false) if params[:includeResolved] == 'false'
    
    order_direction = params[:sort] == 'desc' ? :desc : :asc
    @comments = scope.order(created_at: order_direction)

    render json: {
      success: true,
      count: @comments.size,
      comments: @comments.map(&:as_omnicomment_json)
    }
  end

  # GET /api/documents/:document_id/comments/:id
  def show
    render json: { success: true, comment: @comment.as_omnicomment_json }
  end

  # POST /api/documents/:document_id/comments
  def create
    @comment = Comment.new(comment_params)
    @comment.id ||= "comment-#{SecureRandom.hex(6)}"
    @comment.document_id = @document_id
    @comment.resolved = false
    @comment.orphaned = false
    @comment.thumbs_up = []

    if @comment.save
      render json: { success: true, comment: @comment.as_omnicomment_json }, status: :created
    else
      render json: { success: false, error: @comment.errors.full_messages }, status: :unprocessable_entity
    end
  end

  # PATCH /api/documents/:document_id/comments/:id
  def update
    if @comment.update(update_params)
      render json: { success: true, comment: @comment.as_omnicomment_json }
    else
      render json: { success: false, error: @comment.errors.full_messages }, status: :unprocessable_entity
    end
  end

  # POST /api/documents/:document_id/comments/:id/replies
  def add_reply
    reply = @comment.replies.build(reply_params)
    reply.id ||= "reply-#{SecureRandom.hex(6)}"
    reply.thumbs_up = []

    if reply.save
      @comment.touch # Bump updated_at
      render json: { success: true, reply: reply.as_json }, status: :created
    else
      render json: { success: false, error: reply.errors.full_messages }, status: :unprocessable_entity
    end
  end

  # DELETE /api/documents/:document_id/comments/:id
  def destroy
    @comment.destroy
    render json: { success: true, message: "Comment #{params[:id]} deleted successfully" }
  end

  private

  def set_document_id
    @document_id = params[:document_id]
  end

  def set_comment
    @comment = Comment.find_by!(id: params[:id], document_id: @document_id)
  rescue ActiveRecord::RecordNotFound
    render json: { success: false, error: 'Comment not found' }, status: :not_found
  end

  def comment_params
    params.require(:comment).permit(
      :id,
      :content,
      :author,
      anchor: [:text, :startLine, :startChar, :endLine, :endChar]
    )
  end

  def update_params
    params.require(:comment).permit(:content, :resolved, :orphaned, thumbs_up: [])
  end

  def reply_params
    params.require(:reply).permit(:id, :content, :author)
  end

  def json_request?
    request.format.json?
  end
end
