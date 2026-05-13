# Deployment Guide

## 1. Local Development

```bash
# Install dependencies
npm install

# Test with sample data (5 stocks)
npm run fetch-sample

# Build static files
npm run build

# Start development server
npm run dev
```

The server will be available at http://localhost:3000

## 2. Production Data Fetch

**Important:** Fetching all 500 stocks takes 3-6 hours due to NSE rate limits.

```bash
# Manual: Fetch all 500 stocks
npm run fetch-historical

# Or fetch a limited set for testing
node scripts/fetchHistorical.js 10
```

**GitHub Actions:** Use the manual workflow at:
`https://github.com/yourusername/nse-stock-data/actions/workflows/fetch-historical.yml`

## 3. GitHub Pages Deployment

### Step 1: Create Repository

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/nse-stock-data.git
git push -u origin main
```

### Step 2: Enable GitHub Pages

1. Go to repository Settings → Pages
2. Source: "Deploy from branch"
3. Branch: `main` → `/public` folder
4. Save

Your API will be live at:
```
https://YOUR_USERNAME.github.io/nse-stock-data/
```

### Step 3: Automated Daily Updates

The GitHub Actions workflow will automatically update data every weekday at 4:00 PM IST:

- **Fetch today's data** from NSE
- **Update JSON files** in the repository
- **Rebuild static site**
- **Commit and push** to trigger GitHub Pages rebuild

You can also manually trigger updates from the Actions tab.

## 4. Custom Domain (Optional)

1. Add a `CNAME` file to the `public/` folder:
   ```
   api.yourdomain.com
   ```

2. In GitHub Pages settings, add your custom domain

3. Configure DNS:
   - A Records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Or CNAME → `YOUR_USERNAME.github.io`

## 5. Rate Limiting & Caching

### Server-side Rate Limiting

The Express server includes rate limiting:
- **General API:** 100 requests per 15 minutes
- **Stock endpoints:** 30 requests per minute

Configure in `src/server.js`:
```javascript
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100  // Adjust as needed
});
```

### Cloudflare (Recommended for Production)

Add Cloudflare proxy for unlimited bandwidth and better rate limiting:

1. Sign up at cloudflare.com (free)
2. Add your GitHub Pages site
3. Change nameservers at your domain registrar
4. Configure Page Rules:
   - Cache Everything for `/data/stocks/*` (1 hour)
   - Cache Everything for `/data/metadata/*` (24 hours)

### CDN Caching Headers

GitHub Pages automatically adds:
```
Cache-Control: max-age=600
ETag: "xyz"
```

Override with Cloudflare for better control.

## 6. Monitoring & Health Checks

### Health Endpoint
```
GET /api/health
```
Returns server status and uptime.

### Check Data Freshness
```bash
curl https://YOUR_USERNAME.github.io/nse-stock-data/api/metadata | jq '.lastUpdated'
```

### Setup Alerts (Optional)

Use GitHub Actions to monitor:
- Data update failures
- Server downtime
- Rate limit warnings

Example workflow: Run `curl` requests and send Slack/Discord notifications on failure.

## 7. Troubleshooting

### Build fails with "ENOENT: no such file or directory"
```bash
# Make sure data directories exist
mkdir -p data/stocks data/metadata public/data/stocks public/data/metadata
```

### GitHub Pages shows 404
- Ensure files are in the `public/` folder, not `data/`
- Check that `index.html` exists in `public/`
- Wait 1-2 minutes after push

### Rate limit errors (HTTP 429)
- NSE rate limits are per-IP. Wait 30+ seconds before retrying.
- Consider using a proxy or VPN for large fetches.
- Use caching to avoid repeated requests.

### Server won't start
```bash
# Ensure node version is 18+
node --version

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## 8. Upgrading to Vercel/Cloudflare Pages

If GitHub Pages rate limits become restrictive:

### Vercel (100k req/month free)
1. Create `api/` directory with serverless functions
2. Deploy with Vercel CLI
3. Cron jobs require Pro plan

### Cloudflare Pages
1. Connect GitHub repository
2. Configure build settings
3. Use Cloudflare R2 for data storage
4. Set up cron triggers with Workers

Both options preserve the same API endpoints.

## 9. Backup & Data Export

### Export All Data
```bash
# Download all stock data
node scripts/fetchHistorical.js

# Archive
tar -czf nse-data-backup-$(date +%Y%m%d).tar.gz data/
```

### Database Migration (Optional)
Convert JSON to SQLite/Postgres:
```bash
node scripts/export-to-db.js
```

## 10. Security Considerations

- ❌ Do NOT expose server-side code with API keys in client
- ✅ Use environment variables for secrets
- ✅ Implement rate limiting
- ✅ Validate all user inputs
- ✅ Sanitize CSV output (no injection)
- ✅ Enable HTTPS only (GitHub Pages enforces this)

## Need Help?

- Issues: Create a GitHub issue
- Discussions: Use GitHub Discussions
- NSE API changes: Check `scripts/utils.js` headers configuration
