// Firebase configuration template
// Copy this file to config.js and add your own Firebase credentials
//
// To get these values:
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project (or use an existing one)
// 3. Add a web app to your project
// 4. Copy the configuration values from the Firebase console
// 5. Enable Firestore Database in your project
// 6. Set up App Check with reCAPTCHA v3 (https://console.cloud.google.com/security/recaptcha)

export const firebaseConfig = {
    apiKey: "your-api-key",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
};

// reCAPTCHA v3 site key for Firebase App Check
// Get this from: https://console.cloud.google.com/security/recaptcha
export const recaptchaSiteKey = "your-recaptcha-site-key";
