import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

export interface WorkflowEnv {
  DB: D1Database;
  AI: any;
}

export interface FeedbackWorkflowParams {
  feedbackId: number;
}

export class FeedbackWorkflow extends WorkflowEntrypoint<WorkflowEnv> {
  async run(event: WorkflowEvent<WorkflowEnv>, step: WorkflowStep) {
    console.log('=== Workflow started ===');
    console.log('Event object keys:', Object.keys(event));
    console.log('event.payload:', (event as any).payload);
    console.log('event.params:', event.params);
    console.log('Event payload type:', typeof (event as any).payload);
    console.log('Event params type:', typeof event.params);
    console.log('Event payload stringified:', JSON.stringify((event as any).payload));
    console.log('Event params stringified:', JSON.stringify(event.params));
    console.log('this.env available:', !!(this as any).env);
    console.log('this.env.DB available:', !!(this as any).env?.DB);
    console.log('this.env.AI available:', !!(this as any).env?.AI);

    try {
      // Extract params - Cloudflare Workflows uses event.payload, not event.params
      const params = (event as any).payload || event.params || (event as any).input?.params || {};
      console.log('Extracted params:', params);
      console.log('Params type:', typeof params);
      console.log('Params stringified:', JSON.stringify(params));
      
      // Extract feedbackId from payload first, then fallback to params
      const feedbackId = (params as FeedbackWorkflowParams)?.feedbackId || 
                        ((event as any).payload as FeedbackWorkflowParams)?.feedbackId ||
                        (event.params as FeedbackWorkflowParams)?.feedbackId ||
                        (event as any).input?.params?.feedbackId;
      
      console.log('Extracted feedbackId:', feedbackId);
      console.log('FeedbackId type:', typeof feedbackId);

      // WorkflowEntrypoint provides bindings via this.env, not event.env
      const env = (this as any).env as WorkflowEnv;

      if (!feedbackId) {
        console.error('Feedback ID is missing!');
        console.error('Full event:', JSON.stringify(event, null, 2));
        console.error('Event payload:', JSON.stringify((event as any).payload, null, 2));
        throw new Error('Feedback ID is required but was not provided. Event payload: ' + JSON.stringify((event as any).payload) + ', Event params: ' + JSON.stringify(event.params));
      }

      console.log(`Processing feedback ID: ${feedbackId}`);

      // Step 1: Retrieve feedback data from D1 (idempotent)
      console.log('Step 1: Fetching feedback from DB...');
      const feedback = await step.do('retrieve-feedback', async () => {
        if (!env.DB) {
          console.error('Database not available in workflow');
          throw new Error('Database not available');
        }

        console.log(`Querying database for feedback ID: ${feedbackId}`);
        const result = await env.DB.prepare('SELECT * FROM feedback WHERE id = ?')
          .bind(feedbackId)
          .first<{
            id: number;
            source: string;
            content: string;
            author?: string;
            timestamp?: string;
            sentiment?: string;
            sentiment_score?: number;
            topics?: string;
            processed?: boolean;
          }>();

        console.log('Database query result:', result ? 'Found' : 'Not found');
        
        if (!result) {
          console.error(`Feedback with id ${feedbackId} not found in database`);
          throw new Error(`Feedback with id ${feedbackId} not found`);
        }

        console.log(`Feedback found - Source: ${result.source}, Processed: ${result.processed}`);

        // If already processed, skip
        if (result.processed) {
          console.log(`Feedback ${feedbackId} already processed, skipping workflow`);
          return { skip: true, feedback: result };
        }

        return { skip: false, feedback: result };
      });
      
      console.log('Step 1 completed. Feedback data:', {
        id: feedback.feedback?.id,
        source: feedback.feedback?.source,
        contentLength: feedback.feedback?.content?.length,
        skip: feedback.skip
      });

      // If already processed, return early
      if (feedback.skip) {
        console.log('Workflow completed early - feedback already processed');
        return { success: true, message: 'Feedback already processed', feedbackId };
      }

      // Step 2: Sentiment analysis using Workers AI (idempotent)
      console.log('Step 2: Running sentiment analysis...');
      console.log(`Analyzing content (${feedback.feedback.content.length} chars): ${feedback.feedback.content.substring(0, 100)}...`);
      
      const sentimentResult = await step.do('analyze-sentiment', async () => {
        let sentiment = 'neutral';
        let sentimentScore = 0.5;

        if (!env.AI) {
          console.warn('Workers AI not available, using fallback sentiment analysis');
          throw new Error('Workers AI not available');
        }

        try {
          console.log('Calling Llama for sentiment analysis...');
          const sentimentResponse = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
            messages: [
              {
                role: 'system',
                content: 'You are a sentiment analysis expert. Analyze the sentiment of the following feedback and respond with ONLY one word: POSITIVE, NEGATIVE, or NEUTRAL.'
              },
              {
                role: 'user',
                content: feedback.feedback.content
              }
            ]
          });
          
          console.log('Llama sentiment response:', JSON.stringify(sentimentResponse));
          
          // Extract sentiment from Llama's response
          const responseText = (sentimentResponse?.response || sentimentResponse?.text || '').toUpperCase().trim();
          console.log('Extracted text:', responseText);
          
          if (responseText.includes('POSITIVE')) {
            sentiment = 'POSITIVE';
            sentimentScore = 0.8;
          } else if (responseText.includes('NEGATIVE')) {
            sentiment = 'NEGATIVE';
            sentimentScore = 0.2;
          } else {
            sentiment = 'NEUTRAL';
            sentimentScore = 0.5;
          }
          
          console.log(`Sentiment analysis result: ${sentiment} (score: ${sentimentScore})`);
        } catch (error: any) {
          console.error('Sentiment analysis error:', error);
          console.error('Error type:', error?.constructor?.name);
          console.error('Error message:', error?.message);
          console.error('Error stack:', error?.stack);
          
          // Fallback: simple keyword-based sentiment
          console.log('Using fallback keyword-based sentiment analysis');
          const lowerContent = feedback.feedback.content.toLowerCase();
          if (lowerContent.includes('great') || lowerContent.includes('love') || lowerContent.includes('excellent')) {
            sentiment = 'POSITIVE';
            sentimentScore = 0.8;
            console.log('Fallback: Detected POSITIVE sentiment');
          } else if (lowerContent.includes('bug') || lowerContent.includes('crash') || lowerContent.includes('fix')) {
            sentiment = 'NEGATIVE';
            sentimentScore = 0.3;
            console.log('Fallback: Detected NEGATIVE sentiment');
          } else {
            console.log('Fallback: Defaulting to NEUTRAL sentiment');
          }
        }

        return { sentiment, sentimentScore };
      });
      
      console.log('Step 2 completed. Sentiment result:', sentimentResult);

      // Step 3: Topic extraction using Workers AI (idempotent)
      console.log('Step 3: Extracting topics...');
      
      const topicResult = await step.do('extract-topics', async () => {
        let topics = 'general';

        if (!env.AI) {
          console.warn('Workers AI not available, using fallback topic extraction');
          throw new Error('Workers AI not available');
        }

        try {
          console.log('Calling Workers AI for topic extraction...');
          const topicResponse = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
            messages: [
              {
                role: 'system',
                content: 'Extract the main topics from this feedback. Return only 2-3 comma-separated topics.',
              },
              {
                role: 'user',
                content: feedback.feedback.content,
              },
            ],
          });
          
          console.log('AI topic raw response:', JSON.stringify(topicResponse));
          
          topics = topicResponse?.response || topicResponse?.text || 'general';
          console.log(`Topic extraction result: ${topics}`);
        } catch (error: any) {
          console.error('Topic extraction error:', error);
          console.error('Error type:', error?.constructor?.name);
          console.error('Error message:', error?.message);
          console.error('Error stack:', error?.stack);
          
          // Fallback: extract keywords
          console.log('Using fallback keyword-based topic extraction');
          const keywords = feedback.feedback.content.toLowerCase().match(/\b(dashboard|api|mobile|pricing|feature|bug|ui|login)\b/g);
          topics = keywords ? [...new Set(keywords)].slice(0, 3).join(', ') : 'general';
          console.log(`Fallback topics extracted: ${topics}`);
        }

        return { topics };
      });
      
      console.log('Step 3 completed. Topic result:', topicResult);

      // Step 4: Save results to D1 database (idempotent)
      console.log('Step 4: Saving results to database...');
      console.log('Update values:', {
        sentiment: sentimentResult.sentiment,
        sentimentScore: sentimentResult.sentimentScore,
        topics: topicResult.topics,
        feedbackId
      });
      
      await step.do('save-results', async () => {
        if (!env.DB) {
          console.error('Database not available in save-results step');
          throw new Error('Database not available');
        }

        try {
          const updateResult = await env.DB.prepare(
            'UPDATE feedback SET sentiment = ?, sentiment_score = ?, topics = ?, status = ?, processed = 1 WHERE id = ?'
          )
            .bind(
              sentimentResult.sentiment,
              sentimentResult.sentimentScore,
              topicResult.topics,
              'processed', // Update status to 'processed' after workflow completes
              feedbackId
            )
            .run();

          console.log('Database update successful:', updateResult);
          return { success: true };
        } catch (error: any) {
          console.error('Database update error:', error);
          console.error('Error type:', error?.constructor?.name);
          console.error('Error message:', error?.message);
          console.error('Error stack:', error?.stack);
          throw error;
        }
      });

      console.log('Step 4 completed. All steps successful.');

      const finalResult = {
        success: true,
        feedbackId,
        sentiment: sentimentResult.sentiment,
        sentimentScore: sentimentResult.sentimentScore,
        topics: topicResult.topics,
      };

      console.log('=== Workflow completed successfully ===');
      console.log('Final result:', JSON.stringify(finalResult));

      return finalResult;
    } catch (error: any) {
      console.error('=== WORKFLOW ERROR ===');
      console.error('Error type:', error?.constructor?.name);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      console.error('Error name:', error?.name);
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      console.error('Event payload:', JSON.stringify((event as any).payload));
      console.error('Event params:', JSON.stringify(event.params));
      console.error('Feedback ID from payload:', ((event as any).payload as FeedbackWorkflowParams)?.feedbackId);
      console.error('Feedback ID from params:', (event.params as FeedbackWorkflowParams)?.feedbackId);
      console.error('=== END WORKFLOW ERROR ===');
      
      // Re-throw so it's still logged as failure in workflow system
      throw error;
    }
  }
}