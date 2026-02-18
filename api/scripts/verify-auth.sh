# Login (Success)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantName":"Oilfield Tubular Services","email":"admin@oilfield-tubular-services.com","password":"password123"}'

# Login (Fail)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantName":"Oilfield Tubular Services","email":"admin@oilfield-tubular-services.com","password":"wrong"}'

# Access Protected (Fail)
curl -v http://localhost:3000/auth/me

# Access Protected (Success - requires token)
# export TOKEN=...
# curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/auth/me
