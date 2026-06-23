const jwt = require('jsonwebtoken');

// Bug 1: Hardcoded secret (Triggers Security Agent)
const API_KEY = "ghp_SECRET_TOKEN_DO_NOT_PUSH_X1Y2Z3"; 

async function processUsers(users) {
  // Bug 2: Decoded without signature verification
  const user = jwt.decode(token); 

  // Bug 3: Database query inside an unbatched loop (Triggers Performance Agent)
  for (let i = 0; i < users.length; i++) {
    const data = await db.query("SELECT * FROM users WHERE id = " + users[i].id);
  }
}
