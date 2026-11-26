/* =====================================================
   ADLI FX INTEL INDICATOR
   AUTHENTICATION SYSTEM V1.0
===================================================== */

(function () {
    "use strict";

    const config = window.ADLI_CONFIG;

    if (!config || !config.SUPABASE_URL || !config.SUPABASE_KEY) {
        console.error("ADLI: Supabase configuration missing.");
        return;
    }

    if (!window.supabase) {
        console.error("ADLI: Supabase library not loaded.");
        return;
    }

    const client = window.supabase.createClient(
        config.SUPABASE_URL,
        config.SUPABASE_KEY
    );

    const Auth = {

        // REGISTER NEW MEMBER
        async register(name, phone, email, password) {
            const { data, error } = await client.auth.signUp({
                email: email.trim(),
                password: password,
                options: {
                    data: {
                        full_name: name.trim(),
                        phone: phone.trim()
                    }
                }
            });

            if (error) throw error;

            return data;
        },

        // LOGIN
        async login(email, password) {
            const { data, error } = await client.auth.signInWithPassword({
                email: email.trim(),
                password: password
            });

            if (error) throw error;

            return data;
        },

        // LOGOUT
        async logout() {
            const { error } = await client.auth.signOut();

            if (error) throw error;

            return true;
        },

        // GET CURRENT USER
        async getUser() {
            const { data, error } = await client.auth.getUser();

            if (error) throw error;

            return data.user;
        },

        // GET CURRENT SESSION
        async getSession() {
            const { data, error } = await client.auth.getSession();

            if (error) throw error;

            return data.session;
        },

        // GET SUBSCRIPTION
        async getSubscription() {
            const user = await this.getUser();

            if (!user) return null;

            const { data, error } = await client
                .from("subscriptions")
                .select("status, plan, starts_at, expires_at, created_at")
                .eq("user_id", user.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;

            return data;
        },

        // CHECK ACTIVE ACCESS
       alert("CHECK ACCESS STARTED");
        async checkAccess() {
    consasync checkAccess() {
    const user = await this.getUser();

    if (!user) {
        return {
            loggedIn: false,
            active: false
        };
    }

    const { data, error } = await client.rpc(
        "has_active_subscription"
    );

    if (error) {
        alert(
            "ADLI RPC ERROR\n" +
            "Code: " + (error.code || "N/A") + "\n" +
            "Message: " + (error.message || "N/A") + "\n" +
            "Details: " + (error.details || "N/A") + "\n" +
            "Hint: " + (error.hint || "N/A")
        );

        throw error;
    }

    return {
        loggedIn: true,
        active: data === true,
        user: user
    };
},

        // LISTEN TO AUTH CHANGES
        onAuthChange(callback) {
            return client.auth.onAuthStateChange(
                (event, session) => {
                    if (typeof callback === "function") {
                        callback(event, session);
                    }
                }
            );
        }

    };

    window.ADLI_AUTH = Auth;
    window.ADLI_SUPABASE = client;

    console.log("ADLI Authentication initialized.");

})();
