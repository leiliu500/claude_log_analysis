// SES email sender for the consolidated report.
import {
  SESClient,
  SendEmailCommand,
  type SendEmailCommandOutput,
} from "@aws-sdk/client-ses";

const client = new SESClient({});

export async function sendEmail(opts: {
  sender: string;
  recipients: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<SendEmailCommandOutput> {
  return client.send(
    new SendEmailCommand({
      Source: opts.sender,
      Destination: { ToAddresses: opts.recipients },
      Message: {
        Subject: { Data: opts.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: opts.html, Charset: "UTF-8" },
          Text: { Data: opts.text, Charset: "UTF-8" },
        },
      },
    }),
  );
}
