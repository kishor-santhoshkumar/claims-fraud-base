$body = @{ username='investigator1'; password='demo1234' } | ConvertTo-Json
$response = Invoke-WebRequest -Uri 'http://localhost:8000/auth/login' -Method POST -Body $body -ContentType 'application/json' -ErrorAction SilentlyContinue
Write-Host 'Status:' $response.StatusCode
Write-Host 'Body:' ($response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10)
