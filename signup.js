document.getElementById("registerForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    // 🔥 Render backend URL
    const backendBase = "https://ewallet-backend-2-6ge9.onrender.com";

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
        const response = await fetch(`${backendBase}/api/user/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fullname, email, username, password, espMac })
        });

        // Try safe JSON parse
        let data = {};
        try {
            data = await response.json();
        } catch (err) {
            console.warn("Non-JSON response:", err);
        }

        if (response.ok) {
            alert("Registration successful! Redirecting to login...");
            window.location.href = "login.html";
        } else {
            alert(data.error || "Registration failed.");
        }

    } catch (error) {
        console.error("Signup error:", error);
        alert("Server unreachable. Please try again.\n\nError: " + error.message);
    }
});
