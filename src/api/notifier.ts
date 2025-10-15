export interface IndexNotification {
  specPath: string;
  ref?: string;
  files: number;
  chunks: number;
  createdAt: string;
}

export interface NotifierOptions {
  webhookUrl?: string;
  queueName?: string;
}

export class IndexNotifier {
  constructor(private readonly options: NotifierOptions = {}) {}

  async notify(payload: IndexNotification): Promise<void> {
    await Promise.all([
      this.sendWebhook(payload),
      this.enqueue(payload),
    ]);
  }

  private async sendWebhook(payload: IndexNotification) {
    if (!this.options.webhookUrl) {
      return;
    }
    try {
      await fetch(this.options.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.warn(`Webhook notification failed: ${(error as Error).message}`);
    }
  }

  private async enqueue(payload: IndexNotification) {
    if (!this.options.queueName) {
      return;
    }
    // Placeholder for queue integrations (SQS/NATS). Currently just logs to stdout.
    console.log(`Queue[${this.options.queueName}] <-`, JSON.stringify(payload));
  }
}
