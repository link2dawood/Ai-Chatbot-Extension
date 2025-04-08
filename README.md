# Gemini Chatbot Chrome Extension
This Chrome extension brings the power of Google's Gemini API directly to your browser, allowing you to have intelligent conversations and get quick answers without leaving your current webpage.

## ✨ Key Features

* **Seamless Integration:** Access the chatbot with a simple click from your browser's toolbar.
* **Powered by Gemini API:** Leverage the advanced natural language processing capabilities of Google's Gemini models.
* **Contextual Awareness (Future):** We plan to add features that allow the chatbot to understand the context of the webpage you are currently viewing.
* **Customizable Interface:** (Optional - if implemented) Configure the appearance of the chatbot window.
* **Copy to Clipboard:** Easily copy responses from the chatbot.
* **Lightweight and Fast:** Designed for minimal impact on your Browse experience.

## ⚙️ Installation

### Method 1: Loading Unpacked Extension (For Development and Testing)

1.  **Clone the Repository:**
    ```bash
    git clone <repository_url>
    cd <repository_directory>
    ```

2.  **Open Chrome Extensions:** Go to `chrome://extensions/` in your Chrome browser.

3.  **Enable Developer Mode:** Toggle the "Developer mode" switch in the top right corner.

4.  **Load Unpacked:** Click the "Load unpacked" button in the top left corner.

5.  **Select the Extension Directory:** Choose the directory where you cloned the repository.

### Method 2: Via Chrome Web Store (Coming Soon)

Once the extension is published on the Chrome Web Store, you will be able to install it directly from there. Stay tuned for updates!

## 🚀 Usage

1.  **Install the Extension:** Follow the installation instructions above.

2.  **Pin the Extension (Optional):** For easy access, you can pin the extension icon to your Chrome toolbar.

3.  **Open the Chatbot:** Click the extension icon in your toolbar. A chat window will pop up.

4.  **Start Chatting:** Type your questions or prompts into the input field and press Enter or click the send button.

5.  **View Responses:** The chatbot's responses will appear in the chat window.

## 🔑 API Key Configuration

This extension requires a Google Cloud Project with the Gemini API enabled and a corresponding API key.

1.  **Create a Google Cloud Project:** If you don't have one already, create a new project in the [Google Cloud Console](https://console.cloud.google.com/).

2.  **Enable the Gemini API:**
    * Navigate to the [API Library](https://console.cloud.google.com/apis/library) in your project.
    * Search for "Generative Language API" (or similar, depending on the specific Gemini API being used).
    * Enable the API.

3.  **Create API Credentials:**
    * Go to the [Credentials page](https://console.cloud.google.com/apis/credentials) in your project.
    * Click "Create credentials" and select "API key".
    * **Important Security Note:** For a public repository, you should **NOT** hardcode your API key directly into the extension's code. Instead, implement a secure method for users to provide their own API key. This could involve:
        * **Storing in Chrome's `sync` or `local` storage:** Prompt the user to enter their API key the first time they use the extension and store it securely in their browser's storage.
        * **Backend Proxy (Advanced):** For more complex applications, you might consider using a backend proxy to handle API calls, but this is likely overkill for a simple public extension.

4.  **Configure the Extension:**
    * **If using browser storage:** Modify the extension's code (specifically the part that makes the API call) to retrieve the API key from Chrome's storage. You will need to create a UI element (e.g., a settings page within the extension) where users can input their API key.

    **Example (Conceptual - adapt to your actual implementation):**

    In your extension's JavaScript code:

    ```javascript
    // Example using chrome.storage.sync
    chrome.storage.sync.get(['geminiApiKey'], function(result) {
      const apiKey = result.geminiApiKey;
      if (apiKey) {
        // Use the apiKey to make calls to the Gemini API
        console.log("Gemini API Key found:", apiKey);
        // ... your API call logic ...
      } else {
        console.log("Gemini API Key not found. Please configure in settings.");
        // Optionally, display a message to the user to configure the API key.
      }
    });
    ```

    You would also need to implement a settings page (e.g., a popup or an options page) where users can input and save their API key using `chrome.storage.sync.set({'geminiApiKey': userInputValue})`.

    **Remember to guide users in your extension's UI on how to obtain and enter their API key.**

## 🤝 Contributing

Contributions are welcome! If you'd like to contribute to this project, please follow these steps:

1.  **Fork the Repository:** Create your own fork of this repository.
2.  **Create a Branch:** Make your changes in a new branch.
3.  **Make Your Changes:** Implement your desired features or bug fixes.
4.  **Test Your Changes:** Ensure your changes are working correctly.
5.  **Submit a Pull Request:** Once you're happy with your changes, submit a pull request to the main repository.

Please ensure your code follows the existing style and includes appropriate comments.

## 📄 License

This project is licensed under the [MIT License](LICENSE). See the `LICENSE` file for more information.

## ⚠️ Disclaimer

This Chrome extension utilizes the Google Gemini API, which is a product of Google. By using this extension, you agree to comply with the [Google Cloud Terms of Service](https://cloud.google.com/terms/) and any applicable terms of service for the Gemini API.

Please be aware that the responses generated by the Gemini API are based on the data it has been trained on and may not always be accurate or appropriate. Use your discretion when interpreting and acting upon the information provided by the chatbot.

## 💬 Support

If you encounter any issues or have any questions, please feel free to [open an issue](https://github.com/<your_github_username>/<your_repo_name>/issues).

## 🙏 Acknowledgements

* [Google](https://ai.google.dev/) for providing the powerful Gemini API.
* (Optional: Mention any libraries or resources you used)

---

**Thank you for checking out the Gemini Chatbot Chrome Extension!**
