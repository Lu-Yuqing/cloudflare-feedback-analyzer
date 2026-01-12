# Testing Guide

## Quick Test Checklist

### 1. Local Development Testing

```bash
# Start local development server
npm run dev
```

**Expected Output:**
- Server starts on `http://localhost:8787`
- You should see: "Ready on http://localhost:8787"

**What to Check:**
1. Open browser to `http://localhost:8787`
2. Dashboard should load with statistics
3. You should see feedback items in the list
4. Charts should display (may show zeros if no processed feedback)

### 2. Test Database Connection

```bash
# Check if database has data
wrangler d1 execute feedback-db --command="SELECT COUNT(*) as count FROM feedback"
```

**Expected:** Should return a number (12 if seed data was loaded)

### 3. Test API Endpoints

#### Test Stats Endpoint
```bash
curl http://localhost:8787/api/stats
```

**Expected Response:**
```json
{
  "total": {"count": 12},
  "bySentiment": {"results": [...]},
  "bySource": {"results": [...]},
  "recentTrends": {"results": [...]}
}
```

#### Test Feedback List
```bash
curl http://localhost:8787/api/feedback
```

**Expected:** Array of feedback objects

#### Test Add Feedback
```bash
curl -X POST http://localhost:8787/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"source":"test","content":"This is a test feedback","author":"tester"}'
```

**Expected:** `{"id": 13, "success": true}`

### 4. Test AI Processing

#### Process Pending Feedback
```bash
curl -X POST http://localhost:8787/api/process-pending
```

**Expected:** `{"processed": 12}` (or number of unprocessed items)

**Then check feedback again:**
```bash
curl http://localhost:8787/api/feedback?limit=1
```

**Expected:** Feedback should have `sentiment`, `sentiment_score`, and `topics` fields populated

### 5. Test AI Chat

```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query":"What are the main complaints?"}'
```

**Expected:** `{"response": "..."}` with AI-generated answer

**Note:** If Workers AI is not enabled, you'll get a fallback response.

## Browser Testing

### Dashboard Features to Test

1. **Statistics Cards**
   - Should show Total Feedback count
   - Positive/Negative/Neutral counts
   - Numbers should update after processing

2. **Charts**
   - **Sentiment Chart**: Doughnut chart showing sentiment distribution
   - **Source Chart**: Bar chart showing feedback by source
   - Charts should populate after clicking "Process Pending"

3. **Filters**
   - Select "Support Tickets" from source filter
   - Should show only support ticket feedback
   - Select "Positive" from sentiment filter
   - Should show only positive feedback

4. **AI Chat**
   - Type: "What are the main complaints?"
   - Should get AI response
   - Type: "How many positive feedbacks are there?"
   - Should get relevant answer

5. **Process Pending Button**
   - Click "Process Pending"
   - Wait 2-3 seconds
   - Refresh page or check feedback items
   - Should see sentiment badges and topics

## Common Issues & Solutions

### Issue: "Database not found"
**Solution:**
```bash
# Verify database exists
wrangler d1 list

# If missing, create it
npm run db:create
# Then update wrangler.toml with the database_id
```

### Issue: "Workers AI not working"
**Symptoms:**
- Chat returns fallback responses
- Sentiment analysis fails

**Solutions:**
1. Check if Workers AI is enabled in Cloudflare dashboard
2. Verify you have Workers AI credits
3. Check browser console for errors
4. Fallback mechanisms should still work for basic functionality

### Issue: "Charts not showing"
**Solutions:**
1. Check browser console for JavaScript errors
2. Verify Chart.js CDN is loading
3. Make sure stats endpoint returns data
4. Try processing pending feedback first

### Issue: "No data showing"
**Solutions:**
1. Check if seed data was loaded:
   ```bash
   wrangler d1 execute feedback-db --command="SELECT COUNT(*) FROM feedback"
   ```
2. If count is 0, run:
   ```bash
   npm run db:seed
   ```
3. Refresh the dashboard

### Issue: "CORS errors"
**Solution:**
- CORS headers are already configured in the code
- If issues persist, check that requests are going to the correct origin

## Production Testing

After deployment:

1. **Get your Worker URL:**
   ```bash
   wrangler deploy
   # Note the URL shown, e.g., https://feedback-aggregator.your-subdomain.workers.dev
   ```

2. **Test in Browser:**
   - Visit your Worker URL
   - All features should work the same as local

3. **Test API:**
   ```bash
   curl https://your-worker-url.workers.dev/api/stats
   ```

## Verification Checklist

- [ ] Dashboard loads without errors
- [ ] Statistics cards show numbers
- [ ] Charts render (even if empty)
- [ ] Feedback list displays items
- [ ] Filters work (source and sentiment)
- [ ] "Process Pending" button works
- [ ] After processing, feedback shows sentiment badges
- [ ] AI chat responds to queries
- [ ] API endpoints return JSON
- [ ] No console errors in browser

## Expected Behavior

### Before Processing
- Feedback items show "Pending" badge
- No sentiment or topics displayed
- Charts may show zeros

### After Processing
- Feedback items show sentiment badges (Positive/Negative/Neutral)
- Topics appear below feedback content
- Charts populate with data
- Statistics update

### AI Chat
- Responds to questions about feedback
- Uses context from recent feedback
- May take a few seconds to respond
- Falls back to simple responses if AI unavailable

## Performance Notes

- First AI processing may take 10-30 seconds
- Subsequent requests are faster
- Charts update in real-time
- Stats refresh every 30 seconds automatically

## Need Help?

If something doesn't work:
1. Check browser console (F12) for errors
2. Check terminal where `wrangler dev` is running
3. Verify all setup steps were completed
4. Check `DEPLOYMENT.md` for setup instructions