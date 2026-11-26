/* =====================================================
   ADLI FX INTEL INDICATOR
   AUTHENTICATION SYSTEM V1.2
===================================================== */

(function () {
    "use strict";

    const config = window.ADLI_CONFIG;

    if (!config || !config.SUPABASE_URL || !config.SUPABASE_KEY) {
        console.error("ADLI: Supabase configuration missing.");
        alert("Supabase configuration missing. Check Config.js.");
        return;
    }

    if (!window.supabase) {
        console.error("ADLI: Supabase library not loaded.");
        alert("Supabase library not loaded.");
        return;
    }

    const client = window.supabase.createClient(
        config.SUPABASE_URL,
        config.SUPABASE_KEY
    );

    const Auth = {

        async register(name, phone, email, password) {
            const { data, error } = await client.auth.signUp({
                email: email.trim(),
                password,
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

        async login(email, password) {
            const { data, error } = await client.auth.signInWithPassword({
                email: email.trim(),
                password
            });

            if (error) throw error;
            return data;
        },

        async logout() {
            const { error } = await client.auth.signOut();
            if (error) throw error;
            return true;
        },

        async getUser() {
            const { data, error } = await client.auth.getUser();
            if (error) throw error;
            return data.user;
        },

        async getSession() {
            const { data, error } = await client.auth.getSession();
            if (error) throw error;
            return data.session;
        },

        async getSubscription() {
            const user = await this.getUser();
            if (!user) return null;

            const { data, error } = await client
                .from("subscriptions")
                .select("status, plan_name, starts_at, expires_at, created_at")
                .eq("user_id", user.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;
            return data;
        },

        async checkAccess() {
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
                console.error("ADLI RPC ERROR:", error);
                alert(
                    "Subscription error: " +
                    (error.message || "Unknown error")
                );
                throw error;
            }

            return {
                loggedIn: true,
                active: data === true,
                user: user
            };
        },

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
