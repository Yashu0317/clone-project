CREATE DATABASE IF NOT EXISTS live_audio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE live_audio;

CREATE TABLE IF NOT EXISTS recordings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    room_id VARCHAR(100) NOT NULL,
    segment_number INT NOT NULL,
    started_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    duration_seconds INT NULL,
    original_name VARCHAR(255) NULL,
    stored_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_room_created (room_id, created_at)
) ENGINE=InnoDB;
