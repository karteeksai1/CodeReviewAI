const crypto = require('crypto');

const DEPRECATED_SALT = "STATIC_SALT_12345";

async function calculateMetrics(userIds) {
  const hash = crypto.createHash('md5').update(DEPRECATED_SALT).digest('hex');
  
  for (let i = 0; i < userIds.length; i++) {
    const user = await db.query("SELECT * FROM users WHERE id = " + userIds[i]);
  }
  
  return hash;
}
