document.getElementById("loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    // 🔥 Render backend URL
    const backendBase = "https://ewallet-backend-2-6ge9.onrender.com";

    // Get form values
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!username || !password) {
        alert("Please enter both username and password.");
        return;
    }

    try {
        // Call backend login API
        const response = await fetch(`${backendBase}/api/user/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        // Try reading JSON safely
        let data = {};
        try {
            data = await response.json();
        } catch (err) {
            console.warn("Non-JSON response", err);
        }

        if (response.ok) {
            console.log("Login response:", data);

            // Store session info
            sessionStorage.setItem("username", data.username);
            sessionStorage.setItem("deviceMac", data.espMac);

            // Format MAC for dashboard URL
            const mac = data.espMac?.replace(/:/g, "-");

            alert("Login successful! Redirecting to dashboard...");

            if (mac) {
                window.location.href = `dashboard.html?mac=${mac}`;
            } else {
                window.location.href = "dashboard.html";
            }

        } else if (response.status === 401) {
            alert(data.error || "Invalid username or password.");
        } else {
            alert(data.error || "Login failed: Unknown error occurred.");
        }

    } catch (error) {
        console.error("Login error:", error);
        alert("Server unreachable. Please try again.\n\nError: " + error.message);
    }
});
