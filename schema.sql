-- Feedback table
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    content TEXT NOT NULL,
    author TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    sentiment TEXT,
    sentiment_score REAL,
    topics TEXT,
    category TEXT,
    urgency TEXT,
    summary TEXT,
    status TEXT DEFAULT 'pending',
    processed BOOLEAN DEFAULT 0
);

-- Analysis cache table
CREATE TABLE IF NOT EXISTS analysis_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON feedback(timestamp);
CREATE INDEX IF NOT EXISTS idx_feedback_sentiment ON feedback(sentiment);
CREATE INDEX IF NOT EXISTS idx_feedback_processed ON feedback(processed);