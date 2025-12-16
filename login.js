document.getElementById("loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    // Get form values
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!username || !password) {
        alert("Please enter both username and password.");
        return;
    }

    try {
        // Call backend login API
        const response = await fetch("http://localhost:8080/api/user/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            console.log("Login response:", data);

            // Store session info
            sessionStorage.setItem("username", data.username);
            sessionStorage.setItem("deviceMac", data.espMac);

            // Format MAC for URL
            const mac = data.espMac?.replace(/:/g, "-");

            if (mac) {
                alert("Login successful! Redirecting to dashboard...");
                window.location.href = `dashboard.html?mac=${mac}`;
            } else {
                alert("Login successful but MAC address missing.");
                window.location.href = "dashboard.html";
            }

        } else if (response.status === 401) {
            alert(data.error || "Invalid username or password. Please sign up if you don't have an account.");
        } else {
            alert(data.error || "Login failed: Unknown error occurred.");
        }

    } catch (error) {
        console.error("Login error:", error);
        alert("An unexpected error occurred: " + error.message);
    }
});
