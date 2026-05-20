export interface TokenEndpoint {
  name: string;
  url: string;
  extraData: Record<string, string>;
}

export interface TokenPayload {
  access_token: string;
  next_refresh_token: string;
  token_endpoint: string;
  token_url: string;
}

export interface NormalizedMessage {
  id: string;
  mailbox: string;
  subject: string;
  from: {
    emailAddress: {
      address: string;
      name: string;
    };
  };
  bodyPreview: string;
  body: {
    content: string;
    html: string;
    contentType: 'html' | 'text';
  };
  receivedDateTime: string;
  receivedTimestamp: number;
}

export interface MailboxResult {
  mailbox: string;
  messages: NormalizedMessage[];
  count: number;
}

export interface CollectorResult {
  transport: 'graph' | 'imap' | 'outlook';
  token_payload: TokenPayload;
  mailboxResults: MailboxResult[];
  messages: NormalizedMessage[];
}
