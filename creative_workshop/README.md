# Creative Workshop

Creative Workshop is a chat-style AI creation interface. The first MVP is focused on a browser-local BYOK workflow: users provide their own RunningHub API key and workflow ID, then generate images from natural language prompts.

## Current Scope

- Dark chat-first interface inspired by immersive AI creation tools
- Left sidebar for new chats and local creation history
- Right settings drawer for RunningHub API key, workflow ID, instance type, and node template
- Browser-local settings persistence through `localStorage`
- Static preview cards for the initial UI direction

## Development

```bash
npm install
npm run dev
```

## Validation

```bash
npm run lint
npm run build
```
