const email = "test@stanford.edu";
fetch("http://localhost:5000/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Test User",
    email,
    username: "testuser123",
    password: "password123",
    year: "2029"
  })
})
.then(res => res.json().then(data => ({status: res.status, data})))
.then(console.log)
.catch(console.error);
