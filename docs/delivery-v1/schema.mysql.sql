CREATE DATABASE IF NOT EXISTS shunhui CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE shunhui;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nickname VARCHAR(40) NOT NULL,
  phone VARCHAR(24) NULL UNIQUE,
  password_hash VARCHAR(200) NULL,
  avatar VARCHAR(512) NOT NULL DEFAULT '',
  is_guest BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS meetings (
  id CHAR(9) PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  host_user_id BIGINT UNSIGNED NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  max_participants SMALLINT UNSIGNED NOT NULL,
  password_hash VARCHAR(200) NULL,
  default_mute BOOLEAN NOT NULL DEFAULT TRUE,
  open_waiting_room BOOLEAN NOT NULL DEFAULT FALSE,
  join_before_host BOOLEAN NOT NULL DEFAULT TRUE,
  chat_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('scheduled','ongoing','ended') NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME(3) NULL,
  CONSTRAINT fk_meeting_host FOREIGN KEY (host_user_id) REFERENCES users(id),
  INDEX idx_meeting_host_status (host_user_id, status),
  INDEX idx_meeting_start (starts_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS participants (
  meeting_id CHAR(9) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  nickname VARCHAR(40) NOT NULL,
  role ENUM('host','participant') NOT NULL DEFAULT 'participant',
  joined_at DATETIME(3) NULL,
  left_at DATETIME(3) NULL,
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  audio_forced BOOLEAN NOT NULL DEFAULT FALSE,
  video_forced BOOLEAN NOT NULL DEFAULT FALSE,
  audio_status TINYINT UNSIGNED NOT NULL DEFAULT 0,
  video_status TINYINT UNSIGNED NOT NULL DEFAULT 0,
  screen_share TINYINT UNSIGNED NOT NULL DEFAULT 0,
  waiting BOOLEAN NOT NULL DEFAULT FALSE,
  kicked BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (meeting_id, user_id),
  CONSTRAINT fk_participant_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_participant_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_participant_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS participant_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id CHAR(9) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  action ENUM('join','leave','kick','chat') NOT NULL,
  payload JSON NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_log_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_log_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_log_meeting_time (meeting_id, occurred_at)
) ENGINE=InnoDB;
