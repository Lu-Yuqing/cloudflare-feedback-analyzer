import { FeedbackWorkflow } from './workflow';

// Export workflow for Cloudflare Workflows
export { FeedbackWorkflow };

export interface Env {
  DB: D1Database;
  AI: any; // Workers AI - available when Workers AI is enabled
  FEEDBACK_WORKFLOW: Workflow; // Cloudflare Workflows binding
}

interface Feedback {
  id?: number;
  source: string;
  content: string;
  author?: string;
  timestamp?: string;
  sentiment?: string;
  sentiment_score?: number;
  topics?: string;
  category?: string;
  urgency?: string;
  summary?: string;
  status?: string;
  processed?: boolean;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // API Routes
      if (path === '/api/feedback' && request.method === 'GET') {
        return handleGetFeedback(request, env);
      }
      
      if (path === '/api/feedback' && request.method === 'POST') {
        return handlePostFeedback(request, env, ctx);
      }
      
      if (path === '/api/analyze' && request.method === 'POST') {
        return handleAnalyzeFeedback(request, env);
      }
      
      if (path === '/api/chat' && request.method === 'POST') {
        return handleChat(request, env);
      }
      
      if (path === '/api/stats' && request.method === 'GET') {
        return handleGetStats(env);
      }
      
      if (path === '/api/process-pending' && request.method === 'POST') {
        return handleProcessPending(env);
      }

      // Serve frontend
      if (path === '/' || path.startsWith('/static/')) {
        return handleFrontend(request, path);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

// Get all feedback with optional filters
async function handleGetFeedback(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const source = url.searchParams.get('source');
  const sentiment = url.searchParams.get('sentiment');
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = 'SELECT * FROM feedback WHERE 1=1';
  const params: any[] = [];

  if (source) {
    query += ' AND source = ?';
    params.push(source);
  }
  if (sentiment) {
    query += ' AND sentiment = ?';
    params.push(sentiment);
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = await env.DB.prepare(query).bind(...params).all();
  
  return new Response(JSON.stringify(result.results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Add new feedback
async function handlePostFeedback(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body: Feedback = await request.json();
  
  // Ensure all values are explicitly set to avoid undefined errors in D1
  // Use NULL for fields that will be updated by the workflow
  const result = await env.DB.prepare(
    `INSERT INTO feedback (
      source, 
      content, 
      author, 
      timestamp, 
      sentiment, 
      sentiment_score, 
      topics, 
      category,
      urgency,
      summary,
      status,
      processed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.source,
      body.content,
      body.author ?? null,
      new Date().toISOString(),
      null, // sentiment - will be updated by workflow
      null, // sentiment_score - will be updated by workflow
      null, // topics - will be updated by workflow
      null, // category - will be updated by workflow
      null, // urgency - will be updated by workflow
      null, // summary - will be updated by workflow
      body.status ?? 'pending', // status - default to 'pending'
      0     // processed - false until workflow completes
    )
    .run();

  const feedbackId = result.meta.last_row_id;

  // Trigger Cloudflare Workflow for async processing
  try {
    await env.FEEDBACK_WORKFLOW.create({
      id: `feedback-${feedbackId}`,
      params: { feedbackId },
    });
  } catch (error) {
    console.error('Failed to create workflow:', error);
    // Fallback to direct processing if workflow fails
    ctx.waitUntil(processFeedbackWithAI(env, feedbackId));
  }

  return new Response(JSON.stringify({ id: feedbackId, success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Analyze feedback using Workers AI
async function processFeedbackWithAI(env: Env, feedbackId: number): Promise<void> {
  if (!env.DB) {
    console.error('Database not available for processing feedback');
    return;
  }

  try {
    // Get the feedback
    const feedback = await env.DB.prepare('SELECT * FROM feedback WHERE id = ?')
      .bind(feedbackId)
      .first<Feedback>();

    if (!feedback) return;

    // Sentiment analysis using Workers AI
    let sentiment = 'neutral';
    let sentimentScore = 0.5;
    
    try {
      const sentimentResponse = await env.AI.run('@cf/huggingface/distilbert-sst-2-int8', {
        text: feedback.content,
      });
      sentiment = sentimentResponse?.label || sentimentResponse?.sentiment || 'neutral';
      sentimentScore = sentimentResponse?.score || sentimentResponse?.confidence || 0.5;
    } catch (error) {
      console.error('Sentiment analysis error:', error);
      // Fallback: simple keyword-based sentiment
      const lowerContent = feedback.content.toLowerCase();
      if (lowerContent.includes('great') || lowerContent.includes('love') || lowerContent.includes('excellent')) {
        sentiment = 'POSITIVE';
        sentimentScore = 0.8;
      } else if (lowerContent.includes('bug') || lowerContent.includes('crash') || lowerContent.includes('fix')) {
        sentiment = 'NEGATIVE';
        sentimentScore = 0.3;
      }
    }

    // Topic extraction using Workers AI
    let topics = 'general';
    
    try {
      const topicResponse = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
        messages: [
          {
            role: 'system',
            content: 'Extract the main topics from this feedback. Return only 2-3 comma-separated topics.',
          },
          {
            role: 'user',
            content: feedback.content,
          },
        ],
      });
      topics = topicResponse?.response || topicResponse?.text || 'general';
    } catch (error) {
      console.error('Topic extraction error:', error);
      // Fallback: extract keywords
      const keywords = feedback.content.toLowerCase().match(/\b(dashboard|api|mobile|pricing|feature|bug|ui|login)\b/g);
      topics = keywords ? [...new Set(keywords)].slice(0, 3).join(', ') : 'general';
    }

    // Update feedback with analysis
    await env.DB.prepare(
      'UPDATE feedback SET sentiment = ?, sentiment_score = ?, topics = ?, status = ?, processed = 1 WHERE id = ?'
    )
      .bind(sentiment, sentimentScore, topics, 'processed', feedbackId)
      .run();
  } catch (error) {
    console.error('Error processing feedback with AI:', error);
  }
}

// Analyze specific feedback
async function handleAnalyzeFeedback(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await request.json();
  const feedbackId = body.id;

  await processFeedbackWithAI(env, feedbackId);

  const feedback = await env.DB.prepare('SELECT * FROM feedback WHERE id = ?')
    .bind(feedbackId)
    .first();

  return new Response(JSON.stringify(feedback), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Process all pending feedback
async function handleProcessPending(env: Env): Promise<Response> {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const pending = await env.DB.prepare('SELECT id FROM feedback WHERE processed = 0')
    .all<{ id: number }>();

  // Use workflows for processing
  const workflowPromises = pending.results.map((item) => {
    return env.FEEDBACK_WORKFLOW.create({
      id: `feedback-${item.id}`,
      params: { feedbackId: item.id },
    }).catch((error) => {
      console.error(`Failed to create workflow for feedback ${item.id}:`, error);
      // Fallback to direct processing if workflow fails
      return processFeedbackWithAI(env, item.id);
    });
  });

  await Promise.all(workflowPromises);

  return new Response(JSON.stringify({ processed: pending.results.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// AI Chat interface
async function handleChat(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await request.json();
  const query = body.query;

  // Get relevant feedback context
  const feedback = await env.DB.prepare(
    'SELECT content, sentiment, topics FROM feedback WHERE processed = 1 ORDER BY timestamp DESC LIMIT 10'
  ).all();

  const context = feedback.results
    .map((f: any) => `Feedback: "${f.content}" (Sentiment: ${f.sentiment}, Topics: ${f.topics})`)
    .join('\n');

  // Use Workers AI for chat
  let aiResponse = 'I apologize, but I am unable to process your query at the moment.';
  
  try {
    const response = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant analyzing customer feedback. Here's recent feedback data:\n\n${context}\n\nAnswer questions about this feedback data.`,
        },
        {
          role: 'user',
          content: query,
        },
      ],
    });
    aiResponse = response?.response || response?.text || aiResponse;
  } catch (error) {
    console.error('Chat AI error:', error);
    // Fallback: simple response based on query keywords
    if (query.toLowerCase().includes('complaint') || query.toLowerCase().includes('negative')) {
      const negativeCount = feedback.results.filter((f: any) => f.sentiment === 'NEGATIVE').length;
      aiResponse = `Based on recent feedback, there are ${negativeCount} negative feedback items. Common issues include bugs, crashes, and feature requests.`;
    } else if (query.toLowerCase().includes('positive') || query.toLowerCase().includes('good')) {
      const positiveCount = feedback.results.filter((f: any) => f.sentiment === 'POSITIVE').length;
      aiResponse = `Based on recent feedback, there are ${positiveCount} positive feedback items. Users appreciate improvements and new features.`;
    } else {
      aiResponse = `I found ${feedback.results.length} recent feedback items. Use specific questions about sentiment, topics, or trends for better insights.`;
    }
  }

  // Cache the response
  try {
    await env.DB.prepare('INSERT INTO analysis_cache (query, response) VALUES (?, ?)')
      .bind(query, aiResponse)
      .run();
  } catch (error) {
    console.error('Cache error:', error);
  }

  return new Response(JSON.stringify({ response: aiResponse }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Get statistics
async function handleGetStats(env: Env): Promise<Response> {
  try {
    // Try to query the database - if it fails, we'll catch the error
    const stats = {
      total: await env.DB.prepare('SELECT COUNT(*) as count FROM feedback').first<{ count: number }>(),
      bySentiment: await env.DB.prepare(
        'SELECT sentiment, COUNT(*) as count FROM feedback WHERE processed = 1 GROUP BY sentiment'
      ).all(),
      bySource: await env.DB.prepare(
        'SELECT source, COUNT(*) as count FROM feedback GROUP BY source'
      ).all(),
      recentTrends: await env.DB.prepare(
        `SELECT DATE(timestamp) as date, sentiment, COUNT(*) as count 
         FROM feedback 
         WHERE processed = 1 AND timestamp > datetime('now', '-7 days')
         GROUP BY DATE(timestamp), sentiment
         ORDER BY date DESC`
      ).all(),
    };

    return new Response(JSON.stringify(stats), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error fetching stats:', error);
    return new Response(JSON.stringify({ 
      error: 'Database error', 
      message: error?.message || 'Failed to fetch statistics' 
    }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// Serve frontend
async function handleFrontend(request: Request, path: string): Promise<Response> {
  if (path === '/') {
    return new Response(getHTML(), {
      headers: { 'Content-Type': 'text/html' },
    });
  }
  return new Response('Not Found', { status: 404 });
}

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Feedback Aggregator - Cloudflare</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-gray-50">
    <div class="container mx-auto px-4 py-8">
        <h1 class="text-4xl font-bold mb-8 text-gray-800">Feedback Aggregation & Analysis</h1>
        
        <!-- Stats Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div class="bg-white p-6 rounded-lg shadow">
                <h3 class="text-gray-600 text-sm">Total Feedback</h3>
                <p class="text-3xl font-bold text-blue-600" id="totalFeedback">-</p>
            </div>
            <div class="bg-white p-6 rounded-lg shadow">
                <h3 class="text-gray-600 text-sm">Positive</h3>
                <p class="text-3xl font-bold text-green-600" id="positiveCount">-</p>
            </div>
            <div class="bg-white p-6 rounded-lg shadow">
                <h3 class="text-gray-600 text-sm">Negative</h3>
                <p class="text-3xl font-bold text-red-600" id="negativeCount">-</p>
            </div>
            <div class="bg-white p-6 rounded-lg shadow">
                <h3 class="text-gray-600 text-sm">Neutral</h3>
                <p class="text-3xl font-bold text-gray-600" id="neutralCount">-</p>
            </div>
        </div>

        <!-- Charts -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div class="bg-white p-6 rounded-lg shadow">
                <h2 class="text-xl font-semibold mb-4">Sentiment Distribution</h2>
                <canvas id="sentimentChart"></canvas>
            </div>
            <div class="bg-white p-6 rounded-lg shadow">
                <h2 class="text-xl font-semibold mb-4">Feedback by Source</h2>
                <canvas id="sourceChart"></canvas>
            </div>
        </div>

        <!-- AI Chat Interface -->
        <div class="bg-white p-6 rounded-lg shadow mb-8">
            <h2 class="text-xl font-semibold mb-4">AI Feedback Assistant</h2>
            <div class="mb-4">
                <div id="chatMessages" class="bg-gray-50 p-4 rounded-lg mb-4 h-64 overflow-y-auto">
                    <p class="text-gray-600 text-sm">Ask me anything about the feedback data...</p>
                </div>
                <div class="flex gap-2">
                    <input 
                        type="text" 
                        id="chatInput" 
                        placeholder="e.g., What are the main complaints?" 
                        class="flex-1 px-4 py-2 border rounded-lg"
                    />
                    <button 
                        onclick="sendChatMessage()" 
                        class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>

        <!-- Feedback List -->
        <div class="bg-white p-6 rounded-lg shadow">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Recent Feedback</h2>
                <div class="flex gap-2">
                    <select id="sourceFilter" class="px-4 py-2 border rounded-lg" onchange="loadFeedback()">
                        <option value="">All Sources</option>
                        <option value="support_ticket">Support Tickets</option>
                        <option value="email">Email</option>
                        <option value="survey">Survey</option>
                    </select>
                    <select id="sentimentFilter" class="px-4 py-2 border rounded-lg" onchange="loadFeedback()">
                        <option value="">All Sentiments</option>
                        <option value="POSITIVE">Positive</option>
                        <option value="NEGATIVE">Negative</option>
                        <option value="neutral">Neutral</option>
                    </select>
                    <button 
                        onclick="processPending()" 
                        class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                        Process Pending
                    </button>
                </div>
            </div>
            <div id="feedbackList" class="space-y-4">
                <!-- Feedback items will be loaded here -->
            </div>
        </div>
    </div>

    <script>
        let sentimentChart, sourceChart;

        // Initialize charts
        function initCharts() {
            const sentimentCtx = document.getElementById('sentimentChart').getContext('2d');
            sentimentChart = new Chart(sentimentCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Positive', 'Negative', 'Neutral'],
                    datasets: [{
                        data: [0, 0, 0],
                        backgroundColor: ['#10b981', '#ef4444', '#6b7280']
                    }]
                }
            });

            const sourceCtx = document.getElementById('sourceChart').getContext('2d');
            sourceChart = new Chart(sourceCtx, {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Feedback Count',
                        data: [],
                        backgroundColor: '#3b82f6'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            });
        }

        // Load statistics
        async function loadStats() {
            try {
                const response = await fetch('/api/stats');
                const stats = await response.json();
                
                document.getElementById('totalFeedback').textContent = stats.total?.count || 0;
                
                const sentimentCounts = { POSITIVE: 0, NEGATIVE: 0, neutral: 0 };
                stats.bySentiment?.results?.forEach(item => {
                    sentimentCounts[item.sentiment] = item.count;
                });
                
                document.getElementById('positiveCount').textContent = sentimentCounts.POSITIVE || 0;
                document.getElementById('negativeCount').textContent = sentimentCounts.NEGATIVE || 0;
                document.getElementById('neutralCount').textContent = sentimentCounts.neutral || 0;

                // Update sentiment chart
                sentimentChart.data.datasets[0].data = [
                    sentimentCounts.POSITIVE,
                    sentimentCounts.NEGATIVE,
                    sentimentCounts.neutral
                ];
                sentimentChart.update();

                // Update source chart
                const sources = stats.bySource?.results || [];
                sourceChart.data.labels = sources.map(s => s.source);
                sourceChart.data.datasets[0].data = sources.map(s => s.count);
                sourceChart.update();
            } catch (error) {
                console.error('Error loading stats:', error);
            }
        }

        // Load feedback list
        async function loadFeedback() {
            try {
                const sourceFilter = document.getElementById('sourceFilter').value;
                const sentimentFilter = document.getElementById('sentimentFilter').value;
                
                let url = '/api/feedback?limit=20';
                if (sourceFilter) url += '&source=' + encodeURIComponent(sourceFilter);
                if (sentimentFilter) url += '&sentiment=' + encodeURIComponent(sentimentFilter);
                
                const response = await fetch(url);
                const feedback = await response.json();
                
                const listEl = document.getElementById('feedbackList');
                listEl.innerHTML = feedback.map(item => \`
                    <div class="border-l-4 \${getSentimentColor(item.sentiment)} p-4 bg-gray-50 rounded">
                        <div class="flex justify-between items-start mb-2">
                            <div>
                                <span class="text-sm font-semibold text-gray-700">\${item.source}</span>
                                <span class="text-xs text-gray-500 ml-2">\${new Date(item.timestamp).toLocaleDateString()}</span>
                            </div>
                            <span class="px-2 py-1 text-xs rounded \${getSentimentBadgeClass(item.sentiment)}">
                                \${item.sentiment || 'Pending'}
                            </span>
                        </div>
                        <p class="text-gray-800 mb-2">\${item.content}</p>
                        \${item.topics ? \`<p class="text-xs text-gray-600">Topics: \${item.topics}</p>\` : ''}
                        \${item.author ? \`<p class="text-xs text-gray-500 mt-1">By: \${item.author}</p>\` : ''}
                    </div>
                \`).join('');
            } catch (error) {
                console.error('Error loading feedback:', error);
            }
        }

        function getSentimentColor(sentiment) {
            if (sentiment === 'POSITIVE') return 'border-green-500';
            if (sentiment === 'NEGATIVE') return 'border-red-500';
            return 'border-gray-500';
        }

        function getSentimentBadgeClass(sentiment) {
            if (sentiment === 'POSITIVE') return 'bg-green-100 text-green-800';
            if (sentiment === 'NEGATIVE') return 'bg-red-100 text-red-800';
            return 'bg-gray-100 text-gray-800';
        }

        // Chat functionality
        async function sendChatMessage() {
            const input = document.getElementById('chatInput');
            const query = input.value.trim();
            if (!query) return;

            const messagesEl = document.getElementById('chatMessages');
            messagesEl.innerHTML += \`<div class="mb-2"><strong>You:</strong> \${query}</div>\`;
            input.value = '';

            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query })
                });
                const data = await response.json();
                messagesEl.innerHTML += \`<div class="mb-2 text-blue-600"><strong>AI:</strong> \${data.response}</div>\`;
                messagesEl.scrollTop = messagesEl.scrollHeight;
            } catch (error) {
                messagesEl.innerHTML += \`<div class="mb-2 text-red-600"><strong>Error:</strong> Failed to get response</div>\`;
            }
        }

        // Process pending feedback
        async function processPending() {
            try {
                await fetch('/api/process-pending', { method: 'POST' });
                alert('Processing pending feedback...');
                setTimeout(() => {
                    loadStats();
                    loadFeedback();
                }, 2000);
            } catch (error) {
                console.error('Error processing pending:', error);
            }
        }

        // Enter key for chat
        document.getElementById('chatInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });

        // Initialize
        initCharts();
        loadStats();
        loadFeedback();
        setInterval(loadStats, 30000); // Refresh stats every 30 seconds
    </script>
</body>
</html>`;
}