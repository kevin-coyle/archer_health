# Archer Glucose Monitoring

## Setup

1. **Create follower account** on LibreView (if not already done)
   - Use a separate email like `yourname+libre@gmail.com`
   - Have the patient invite this account as a follower in LibreLink app

2. **Configure environment variables**
   ```bash
   cd ~/dev/dashboard
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Deploy**
   ```bash
   ./deploy.sh
   ```

## Manual Data Import

### Realtime API (Recommended)
Fetches last ~12 hours of readings via LibreView API:
```bash
docker exec dashboard node /app/scripts/fetch-libre-realtime.js --import
```

### CSV Import (Fallback)
If you have a CSV export from LibreView:
```bash
docker exec dashboard node /app/scripts/import-glucose.js /path/to/file.csv
```

## Automated Updates

### Cron Job (runs every 15 minutes)
```bash
crontab -e
```

Add:
```cron
*/15 * * * * docker exec dashboard node /app/scripts/fetch-libre-realtime.js --import >> /tmp/glucose-sync.log 2>&1
```

## API Endpoints

### Get Recent Readings
```bash
curl http://framedesk.local:3000/api/glucose/readings?hours=24
```

### Get Latest Reading
```bash
curl http://framedesk.local:3000/api/glucose/latest
```

### Record Insulin Dose
```bash
curl -X POST http://framedesk.local:3000/api/glucose/insulin \
  -H "Content-Type: application/json" \
  -d '{"units": 5, "insulinType": "rapid", "notes": "Before dinner"}'
```

### Record Intervention
```bash
curl -X POST http://framedesk.local:3000/api/glucose/intervention \
  -H "Content-Type: application/json" \
  -d '{"interventionType": "food", "description": "Apple juice", "carbs": 15}'
```

## Technical Notes

- **Data Source**: LibreView API (follower account)
- **Update Frequency**: 5-minute readings from Libre 3 sensor
- **Libre Offset**: +3.2 mmol/L (sensor runs low for Archer)
- **Target Range**: 6.0-12.0 mmol/L
- **Database**: SQLite (`/app/data/eyedrops.db` in container)

## Troubleshooting

### "readonly database" error
The database is owned by the Docker container. Always run import scripts via `docker exec`.

### No readings returned
- Check follower account is set up correctly
- Verify LibreLink app is uploading data
- Check credentials in `.env`

### Cloudflare blocks
The script uses mobile app headers to avoid blocking. If you still see Cloudflare errors, wait a few minutes and retry.
