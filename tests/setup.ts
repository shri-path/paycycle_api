// Jest global test setup
// Set test environment variables before importing anything
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:1234@localhost:5432/paycycle_db';
process.env['JWT_SECRET'] = 'test-jwt-secret-key-minimum-32-characters-long';
process.env['JWT_ACCESS_EXPIRY'] = '1h';
process.env['JWT_REFRESH_EXPIRY'] = '30d';
process.env['PORT'] = '3001';
process.env['API_VERSION'] = 'v1';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['RATE_LIMIT_WINDOW_MS'] = '900000';
process.env['RATE_LIMIT_MAX_REQUESTS'] = '100';
process.env['LOG_LEVEL'] = 'silent';
process.env['DEFAULT_PAGE_SIZE'] = '20';
process.env['MAX_PAGE_SIZE'] = '100';
