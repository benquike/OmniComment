package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// -----------------------------------------------------------------------------
// Domain Types (OmniComment & W3C Compatible)
// -----------------------------------------------------------------------------

// CommentAnchor represents the exact document coordinates of the annotated text.
type CommentAnchor struct {
	Text      string `json:"text" binding:"required"`
	StartLine int    `json:"startLine"`
	StartChar int    `json:"startChar"`
	EndLine   int    `json:"endLine"`
	EndChar   int    `json:"endChar"`
}

// CommentReply represents a discussion response inside a thread.
type CommentReply struct {
	ID        string    `json:"id"`
	Content   string    `json:"content" binding:"required"`
	Author    string    `json:"author" binding:"required"`
	CreatedAt string    `json:"createdAt"`
	UpdatedAt *string   `json:"updatedAt,omitempty"`
	ThumbsUp  []string  `json:"thumbsUp"`
}

// OmniComment represents a full comment thread.
type OmniComment struct {
	ID         string         `json:"id"`
	DocumentID string         `json:"documentId"`
	Anchor     CommentAnchor  `json:"anchor" binding:"required"`
	Content    string         `json:"content" binding:"required"`
	Author     string         `json:"author" binding:"required"`
	CreatedAt  string         `json:"createdAt"`
	UpdatedAt  string         `json:"updatedAt"`
	Resolved   bool           `json:"resolved"`
	Orphaned   bool           `json:"orphaned"`
	ThumbsUp   []string       `json:"thumbsUp"`
	Replies    []CommentReply `json:"replies"`
}

// CreateCommentDto represents the payload required to create a new thread.
type CreateCommentDto struct {
	ID      string        `json:"id,omitempty"`
	Anchor  CommentAnchor `json:"anchor" binding:"required"`
	Content string        `json:"content" binding:"required"`
	Author  string        `json:"author" binding:"required"`
}

// UpdateCommentDto represents mutable thread properties.
type UpdateCommentDto struct {
	Content  *string   `json:"content,omitempty"`
	Resolved *bool     `json:"resolved,omitempty"`
	Orphaned *bool     `json:"orphaned,omitempty"`
	ThumbsUp *[]string `json:"thumbsUp,omitempty"`
}

// AddReplyDto represents the payload to append a reply.
type AddReplyDto struct {
	ID      string `json:"id,omitempty"`
	Content string `json:"content" binding:"required"`
	Author  string `json:"author" binding:"required"`
}

// -----------------------------------------------------------------------------
// Concurrency-Safe Persistent Storage Engine
// -----------------------------------------------------------------------------

// StorageEngine provides thread-safe access with JSON file persistence.
type StorageEngine struct {
	mu       sync.RWMutex
	filePath string
	// map of documentId -> map of commentId -> OmniComment
	data map[string]map[string]*OmniComment
}

// NewStorageEngine initializes the storage and loads existing data from disk.
func NewStorageEngine(filePath string) (*StorageEngine, error) {
	engine := &StorageEngine{
		filePath: filePath,
		data:     make(map[string]map[string]*OmniComment),
	}

	if _, err := os.Stat(filePath); err == nil {
		bytes, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed reading storage file: %w", err)
		}
		if len(bytes) > 0 {
			var loaded map[string]map[string]*OmniComment
			if err := json.Unmarshal(bytes, &loaded); err == nil {
				engine.data = loaded
			}
		}
	}
	return engine, nil
}

// saveToDisk writes current in-memory state to disk atomically.
func (s *StorageEngine) saveToDisk() error {
	bytes, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmpFile := s.filePath + ".tmp"
	if err := os.WriteFile(tmpFile, bytes, 0644); err != nil {
		return err
	}
	return os.Rename(tmpFile, s.filePath)
}

// ListComments retrieves comments for a document.
func (s *StorageEngine) ListComments(docID string, includeResolved bool, sortOrder string) []*OmniComment {
	s.mu.RLock()
	defer s.mu.RUnlock()

	docMap, exists := s.data[docID]
	if !exists {
		return []*OmniComment{}
	}

	result := make([]*OmniComment, 0, len(docMap))
	for _, c := range docMap {
		if !includeResolved && c.Resolved {
			continue
		}
		result = append(result, c)
	}

	// Sort comments by CreatedAt
	sort.Slice(result, func(i, j int) bool {
		if sortOrder == "desc" {
			return result[i].CreatedAt > result[j].CreatedAt
		}
		return result[i].CreatedAt < result[j].CreatedAt
	})

	return result
}

// GetComment retrieves a single comment.
func (s *StorageEngine) GetComment(docID, commentID string) (*OmniComment, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	docMap, exists := s.data[docID]
	if !exists {
		return nil, false
	}
	comment, found := docMap[commentID]
	return comment, found
}

// CreateComment saves a new comment thread.
func (s *StorageEngine) CreateComment(docID string, comment *OmniComment) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.data[docID]; !exists {
		s.data[docID] = make(map[string]*OmniComment)
	}
	s.data[docID][comment.ID] = comment
	return s.saveToDisk()
}

// UpdateComment applies patches to a thread.
func (s *StorageEngine) UpdateComment(docID, commentID string, patch UpdateCommentDto) (*OmniComment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	docMap, exists := s.data[docID]
	if !exists {
		return nil, fmt.Errorf("comment not found")
	}
	comment, found := docMap[commentID]
	if !found {
		return nil, fmt.Errorf("comment not found")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	comment.UpdatedAt = now

	if patch.Content != nil {
		comment.Content = *patch.Content
	}
	if patch.Resolved != nil {
		comment.Resolved = *patch.Resolved
	}
	if patch.Orphaned != nil {
		comment.Orphaned = *patch.Orphaned
	}
	if patch.ThumbsUp != nil {
		comment.ThumbsUp = *patch.ThumbsUp
	}

	if err := s.saveToDisk(); err != nil {
		return nil, err
	}
	return comment, nil
}

// AddReply appends a reply to a thread.
func (s *StorageEngine) AddReply(docID, commentID string, reply CommentReply) (*CommentReply, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	docMap, exists := s.data[docID]
	if !exists {
		return nil, fmt.Errorf("comment not found")
	}
	comment, found := docMap[commentID]
	if !found {
		return nil, fmt.Errorf("comment not found")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	comment.UpdatedAt = now
	comment.Replies = append(comment.Replies, reply)

	if err := s.saveToDisk(); err != nil {
		return nil, err
	}
	return &reply, nil
}

// DeleteComment removes a comment thread.
func (s *StorageEngine) DeleteComment(docID, commentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	docMap, exists := s.data[docID]
	if !exists {
		return fmt.Errorf("comment not found")
	}
	if _, found := docMap[commentID]; !found {
		return fmt.Errorf("comment not found")
	}

	delete(docMap, commentID)
	return s.saveToDisk()
}

// -----------------------------------------------------------------------------
// HTTP Handlers & Router Setup
// -----------------------------------------------------------------------------

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, PATCH, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func main() {
	dbPath := os.Getenv("OMNICOMMENT_DATA_PATH")
	if dbPath == "" {
		dbPath = "comments.json"
	}

	storage, err := NewStorageEngine(dbPath)
	if err != nil {
		log.Fatalf("Fatal: failed to initialize storage: %v", err)
	}

	r := gin.Default()
	r.Use(corsMiddleware())

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "ok",
			"service":   "omnicomment-go-gin",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	})

	// Comments REST endpoints
	r.GET("/api/documents/:docId/comments", func(c *gin.Context) {
		docID := c.Param("docId")
		includeResolved := c.DefaultQuery("includeResolved", "true") != "false"
		sortOrder := c.DefaultQuery("sort", "asc")

		comments := storage.ListComments(docID, includeResolved, sortOrder)
		c.JSON(http.StatusOK, gin.H{
			"success":  true,
			"count":    len(comments),
			"comments": comments,
		})
	})

	r.GET("/api/documents/:docId/comments/:commentId", func(c *gin.Context) {
		docID := c.Param("docId")
		commentID := c.Param("commentId")

		comment, found := storage.GetComment(docID, commentID)
		if !found {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Comment not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "comment": comment})
	})

	r.POST("/api/documents/:docId/comments", func(c *gin.Context) {
		docID := c.Param("docId")
		var dto CreateCommentDto
		if err := c.ShouldBindJSON(&dto); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
			return
		}

		commentID := dto.ID
		if commentID == "" {
			commentID = fmt.Sprintf("comment-%s", uuid.New().String()[:12])
		}

		now := time.Now().UTC().Format(time.RFC3339)
		comment := &OmniComment{
			ID:         commentID,
			DocumentID: docID,
			Anchor:     dto.Anchor,
			Content:    dto.Content,
			Author:     dto.Author,
			CreatedAt:  now,
			UpdatedAt:  now,
			Resolved:   false,
			Orphaned:   false,
			ThumbsUp:   []string{},
			Replies:    []CommentReply{},
		}

		if err := storage.CreateComment(docID, comment); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"success": true, "comment": comment})
	})

	r.PATCH("/api/documents/:docId/comments/:commentId", func(c *gin.Context) {
		docID := c.Param("docId")
		commentID := c.Param("commentId")

		var patch UpdateCommentDto
		if err := c.ShouldBindJSON(&patch); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
			return
		}

		updated, err := storage.UpdateComment(docID, commentID, patch)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "comment": updated})
	})

	r.POST("/api/documents/:docId/comments/:commentId/replies", func(c *gin.Context) {
		docID := c.Param("docId")
		commentID := c.Param("commentId")

		var dto AddReplyDto
		if err := c.ShouldBindJSON(&dto); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
			return
		}

		replyID := dto.ID
		if replyID == "" {
			replyID = fmt.Sprintf("reply-%s", uuid.New().String()[:12])
		}

		now := time.Now().UTC().Format(time.RFC3339)
		reply := CommentReply{
			ID:        replyID,
			Content:   dto.Content,
			Author:    dto.Author,
			CreatedAt: now,
			UpdatedAt: &now,
			ThumbsUp:  []string{},
		}

		createdReply, err := storage.AddReply(docID, commentID, reply)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"success": true, "reply": createdReply})
	})

	r.DELETE("/api/documents/:docId/comments/:commentId", func(c *gin.Context) {
		docID := c.Param("docId")
		commentID := c.Param("commentId")

		if err := storage.DeleteComment(docID, commentID); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "Comment deleted successfully"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("OmniComment Go (Gin) server listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
