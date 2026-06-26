// SNS publisher for high-severity alerts.
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const client = new SNSClient({});

export async function publishAlert(opts: {
  topicArn: string;
  subject: string;
  message: string;
  /** Message attributes for subscription filter policies (e.g. severity). */
  attributes?: Record<string, string>;
}): Promise<void> {
  await client.send(
    new PublishCommand({
      TopicArn: opts.topicArn,
      // SNS subjects are capped at 100 chars and disallow newlines.
      Subject: opts.subject.replace(/\s+/g, " ").slice(0, 100),
      Message: opts.message,
      MessageAttributes: Object.fromEntries(
        Object.entries(opts.attributes ?? {}).map(([k, v]) => [
          k,
          { DataType: "String", StringValue: v },
        ]),
      ),
    }),
  );
}
