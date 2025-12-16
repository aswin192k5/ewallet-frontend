document.getElementById("registerForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    const fullname = document.getElementById("fullname").value.trim();
    const email = document.getElementById("email").value.trim();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const espMac = document.getElementById("espMac").value.trim();

    if (!fullname || !email || !username || !password || !confirmPassword || !espMac) {
        alert("Please fill in all fields.");
        return;
    }

    if (password !== confirmPassword) {
        alert("Passwords do not match!");
        return;
    }

    try {
        const response = await fetch("http://localhost:8080/api/user/signup", { // ✅ correct endpoint
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fullname, email, username, password, espMac })
        });

        const data = await response.json();

        if (response.ok) {
            alert("Registration successful! Redirecting to login...");
            window.location.href = "login.html";
        } else {
            // Handle backend errors (username, email, espMac)
            alert(data.error || "Registration failed: Unknown error occurred.");
        }
    } catch (error) {
        console.error("Signup error:", error);
        alert("Error connecting to server: " + error.message);
    }
});
