# Cloudflare Workers ACME DNS

A stateless implementation of the acme-dns API using Cloudflare Workers.

## Configuration

Configure variables & secrets using Cloudflare Dashboard. See [docs](https://developers.cloudflare.com/workers/configuration/environment-variables/#add-environment-variables-via-the-dashboard).

Variables (aka. Text / Plaintext):
- `DOMAIN_SUFFIX`: `acme.example.com`
- `CLOUDFLARE_ZONE_ID`: `your-cloudflare-zone-id`

Secrets:
- `HMAC_SECRET`: `entropy-please`
- `CLOUDFLARE_API_TOKEN`: `cloudflare-api-token-with-dns-edit-permission``

## API Endpoints

### POST /register

Creates a new ACME DNS entry. Returns credentials for DNS updates.

**Request:**
```json
{
  "allowfrom": [
    "192.168.100.1/24",
    "1.2.3.4/32",
    "2002:c0a8:2a00::0/40"
  ]
}
```

Note: The `allowfrom` parameter is accepted but ignored. This implementation does not store IP restrictions or enforce client IP addresses during updates.

**Response:**
```json
{
  "allowfrom": [
    "0.0.0.0/0",
    "::/0"
  ],
  "fulldomain": "123e4567-e89b-12d3-a456-426614174000.acme.example.com",
  "password": "hmac-generated-password",
  "subdomain": "123e4567-e89b-12d3-a456-426614174000",
  "username": "123e4567-e89b-12d3-a456-426614174000"
}
```

The response `allowfrom` field shows `["0.0.0.0/0", "::/0"]` to explicitly indicate that updates are accepted from any IP address (no IP restrictions enforced).

### POST /update

Updates the TXT record for the subdomain.

**Headers:**
```
X-Api-User: 123e4567-e89b-12d3-a456-426614174000
X-Api-Key: hmac-generated-password
```

**Request:**
```json
{
  "subdomain": "123e4567-e89b-12d3-a456-426614174000",
  "txt": "challenge-value"
}
```

**Response:**
```json
{
  "txt": "challenge-value"
}
```

## Key Differences from Original acme-dns

- **Stateless**: No database required
- **No allowfrom enforcement**: Accepts updates from any IP (returns `["0.0.0.0/0", "::/0"]` to make this explicit)
- **HMAC-based authentication**: Password is HMAC of username with secret key
- **Username = Subdomain**: Simplified model where username and subdomain are identical UUIDs
- **Cloudflare DNS integration**: Uses Cloudflare for DNS records persistence and hosting

## Deployment

1. Install Wrangler CLI: `npm install -g wrangler` or `brew install cloudflare-wrangler`
2. Configure variables and secrets properly
3. Execute `wrangler deploy`
