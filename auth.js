async function register() {
  await fetch("/api/register", {
    method: "POST",
    body: JSON.stringify({
      username: u.value,
      password: p.value
    })
  });
  alert("登録完了");
}

async function login() {
  const res = await fetch("/api/login", {
    method: "POST",
    body: JSON.stringify({
      username: u.value,
      password: p.value
    })
  });
  const data = await res.json();

  if (data.ok) {
    localStorage.user = JSON.stringify(data.user);
    location.href = "profile.html";
  }
}
