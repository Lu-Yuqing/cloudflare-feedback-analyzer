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
    const { feedbackId } = event.params as FeedbackWorkflowParams;
    const env = event.env;

    // Step 1: Retrieve feedback data from D1 (idempotent)
    const feedback = await step.do('retrieve-feedback', async () => {
      if (!env.DB) {
        throw new Error('Database not available');
      }

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

      if (!result) {
        throw new Error(`Feedback with id ${feedbackId} not found`);
      }

      // If already processed, skip
      if (result.processed) {
        return { skip: true, feedback: result };
      }

      return { skip: false, feedback: result };
    });

    // If already processed, return early
    if (feedback.skip) {
      return { success: true, message: 'Feedback already processed', feedbackId };
    }

    // Step 2: Sentiment analysis using Workers AI (idempotent)
    const sentimentResult = await step.do('analyze-sentiment', async () => {
      let sentiment = 'neutral';
      let sentimentScore = 0.5;

      try {
        const sentimentResponse = await env.AI.run('@cf/huggingface/distilbert-sst-2-int8', {
          text: feedback.feedback.content,
        });
        sentiment = sentimentResponse?.label || sentimentResponse?.sentiment || 'neutral';
        sentimentScore = sentimentResponse?.score || sentimentResponse?.confidence || 0.5;
      } catch (error) {
        console.error('Sentiment analysis error:', error);
        // Fallback: simple keyword-based sentiment
        const lowerContent = feedback.feedback.content.toLowerCase();
        if (lowerContent.includes('great') || lowerContent.includes('love') || lowerContent.includes('excellent')) {
          sentiment = 'POSITIVE';
          sentimentScore = 0.8;
        } else if (lowerContent.includes('bug') || lowerContent.includes('crash') || lowerContent.includes('fix')) {
          sentiment = 'NEGATIVE';
          sentimentScore = 0.3;
        }
      }

      return { sentiment, sentimentScore };
    });

    // Step 3: Topic extraction using Workers AI (idempotent)
    const topicResult = await step.do('extract-topics', async () => {
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
              content: feedback.feedback.content,
            },
          ],
        });
        topics = topicResponse?.response || topicResponse?.text || 'general';
      } catch (error) {
        console.error('Topic extraction error:', error);
        // Fallback: extract keywords
        const keywords = feedback.feedback.content.toLowerCase().match(/\b(dashboard|api|mobile|pricing|feature|bug|ui|login)\b/g);
        topics = keywords ? [...new Set(keywords)].slice(0, 3).join(', ') : 'general';
      }

      return { topics };
    });

    // Step 4: Save results to D1 database (idempotent)
    await step.do('save-results', async () => {
      if (!env.DB) {
        throw new Error('Database not available');
      }

      await env.DB.prepare(
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

      return { success: true };
    });

    return {
      success: true,
      feedbackId,
      sentiment: sentimentResult.sentiment,
      sentimentScore: sentimentResult.sentimentScore,
      topics: topicResult.topics,
    };
  }
}