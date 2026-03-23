# Green API V2 - Media & File Download Documentation

## Incoming Webhook Types

To receive incoming notifications about image, video, audio, and document messages, the following conditions must be met:
- `typeWebhook`: `incomingMessageReceived`
- `messageData.typeMessage`: `imageMessage`, `videoMessage`, `documentMessage`, or `audioMessage`

### Webhook Body Structure
- **typeMessage**: The type of received message.
- **fileMessageData**: Contains `downloadUrl`, `caption`, `fileName`, `jpegThumbnail`, `mimeType`, etc.
- **quotedMessage**: (Optional) Data about the message being quoted.

#### Example Payload (Image)
```json
{
  "typeWebhook": "incomingMessageReceived",
  "idMessage": "...",
  "messageData": {
    "typeMessage": "imageMessage",
    "fileMessageData": {
      "downloadUrl": "https://api.greenapi.com/...",
      "caption": "Image Caption",
      "mimeType": "image/jpeg"
    }
  }
}
```

## DownloadFile Method (POST)
Used to download files by `chatId` and `idMessage`.

- **Endpoint**: `{{apiUrl}}/waInstance{{idInstance}}/downloadFile/{{apiTokenInstance}}`
- **Body**: `{ "chatId": "...", "idMessage": "..." }`
- **Response**: `{ "downloadUrl": "..." }`

### Potential Errors
- **400 Bad Request**: Validation failed or file missing in the message.
- **500 Internal error**: File not available on WhatsApp servers (expired).
