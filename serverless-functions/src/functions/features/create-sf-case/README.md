# Server-Side Salesforce Case Creation

## Overview

Replaces browser-side OpenCTI `saveLog()` with server-side Twilio Functions that call Salesforce REST API directly. Eliminates the 3% failure rate caused by:
- Agent SF session expiry
- OpenCTI script load race conditions
- Browser network instability
- SF iframe context unavailability

## Architecture

```
Before (browser-side, unreliable):
  Agent browser → window.sforce.opencti.saveLog() → SF API

After (server-side, reliable):
  Agent browser → Twilio Serverless Function → SF REST API (OAuth)
                                                     ↓
  Agent browser ← screenPop(caseId) ← task attributes updated with ticketId
```

## Functions

| Endpoint | Purpose |
|----------|---------|
| `POST /features/create-sf-case/flex/create-case` | Create a new SF Case |
| `POST /features/create-sf-case/flex/update-case-owner` | Update Case owner on transfer |

## Required Environment Variables

Add these to your `.env` file (or Twilio Console → Functions → Environment Variables):

```bash
# Salesforce Connected App credentials (EMEA org)
SF_LOGIN_URL=https://aligntechnology.my.salesforce.com
SF_CLIENT_ID=<Connected App Consumer Key>
SF_CLIENT_SECRET=<Connected App Consumer Secret>
SF_USERNAME=<Integration User email>
SF_PASSWORD=<Integration User password + security token>

# Case configuration
SF_CASE_RECORD_TYPE_ID=012i00000019r5uAAA

# TaskRouter (already should exist)
TWILIO_FLEX_WORKSPACE_SID=WSb2f913b3d73a1b03226f155ee40c5b30
```

## Connected App Setup (already done)

The Connected App should have:
- **OAuth Scopes:** `api`, `refresh_token`
- **IP Relaxation:** Enforce IP restrictions (whitelist Twilio function IPs) or "Relax IP restrictions"
- **Run As:** Integration user with permission to create Cases

## Deployment

```bash
cd serverless-functions
npm run deploy
```

## Testing

```bash
# Test locally
twilio serverless:start

# curl test
curl -X POST http://localhost:3000/features/create-sf-case/flex/create-case \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "Token=<flex_token>&taskSid=WTtest123&caller=+4912345&callSid=CAtest&direction=inbound"
```
