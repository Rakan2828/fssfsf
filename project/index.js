const express = require('express');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const port = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

// Bot configuration
const token = process.env.TELEGRAM_BOT_TOKEN || '7884916290:AAF43Q7tKM9Ewt-JfCJCg_cIs6yveaFcftw';
let bot = null;
let pollingActive = false;
let botLock = false;

// Store chat IDs that the bot should send messages to
const chatIds = new Set();
let messageInterval;

async function acquireLock() {
    if (botLock) {
        return false;
    }
    botLock = true;
    return true;
}

async function releaseLock() {
    botLock = false;
}

async function forceCleanup() {
    pollingActive = false;
    
    if (messageInterval) {
        clearInterval(messageInterval);
        messageInterval = null;
    }
    
    if (bot) {
        try {
            // Stop polling and wait for it to complete
            await bot.stopPolling({ cancel: true });
            
            // Force close any existing connections
            if (bot._polling) {
                bot._polling.abort();
            }
            
            // Remove all listeners
            bot.removeAllListeners();
            
            // Wait for connections to fully close
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Destroy the bot instance
            bot = null;
            
            // Additional wait to ensure Telegram's servers register the disconnection
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            console.error('Error in force cleanup:', error);
            // Wait even on error to ensure cleanup
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
}

async function createNewBot() {
    await forceCleanup();
    
    // Wait additional time before creating new bot
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const newBot = new TelegramBot(token, { 
        polling: false,
        filepath: false,
        baseApiUrl: "https://api.telegram.org",
        request: {
            timeout: 30000,
            agent: null // Force new agent for each bot instance
        }
    });
    
    // Error handling for bot
    newBot.on('error', async (error) => {
        console.error('Telegram Bot Error:', error.message);
        if (error.code === 'ETELEGRAM') {
            await stopBot();
        }
    });
    
    // Handle polling_error specifically
    newBot.on('polling_error', async (error) => {
        console.error('Polling Error:', error.message);
        if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
            await stopBot();
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait longer on conflict
        }
    });

    // Handle /start command
    newBot.onText(/\/start/, (msg) => {
        try {
            const chatId = msg.chat.id;
            chatIds.add(chatId);
            newBot.sendMessage(chatId, 'تم تفعيل رسائل التذكير. ستصلك رسالة كل دقيقة إن شاء الله');
        } catch (error) {
            console.error('Error in /start handler:', error);
        }
    });

    // Handle /stop command
    newBot.onText(/\/stop/, (msg) => {
        try {
            const chatId = msg.chat.id;
            chatIds.delete(chatId);
            newBot.sendMessage(chatId, 'تم إيقاف رسائل التذكير');
        } catch (error) {
            console.error('Error in /stop handler:', error);
        }
    });

    return newBot;
}

async function startBot() {
    if (!await acquireLock()) {
        console.log('Bot is already being started/stopped');
        return false;
    }

    try {
        if (pollingActive) {
            await stopBot();
        }

        await forceCleanup();
        bot = await createNewBot();
        
        // Wait before starting polling
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Start polling with specific options to prevent conflicts
        await bot.startPolling({
            restart: false,
            timeout: 30,
            limit: 100,
            retryAfter: 5000,
            polling: {
                params: {
                    timeout: 30
                },
                interval: 2000
            }
        });
        
        pollingActive = true;
        
        messageInterval = setInterval(() => {
            if (!pollingActive || !bot) {
                clearInterval(messageInterval);
                return;
            }
            
            chatIds.forEach(chatId => {
                if (bot && pollingActive) {
                    bot.sendMessage(chatId, 'اذكر الله').catch(error => {
                        console.error(`Error sending message to ${chatId}:`, error);
                        if (error.code === 'ETELEGRAM' && error.response?.statusCode === 403) {
                            chatIds.delete(chatId);
                        }
                    });
                }
            });
        }, 60000);
        
        return true;
    } catch (error) {
        console.error('Error starting bot:', error);
        pollingActive = false;
        return false;
    } finally {
        await releaseLock();
    }
}

async function stopBot() {
    if (!await acquireLock()) {
        console.log('Bot is already being started/stopped');
        return false;
    }

    try {
        await forceCleanup();
        return true;
    } catch (error) {
        console.error('Error stopping bot:', error);
        return false;
    } finally {
        await releaseLock();
    }
}

// API endpoints
app.post('/api/start', async (req, res) => {
    const success = await startBot();
    res.json({ status: success ? 'started' : 'error' });
});

app.post('/api/stop', async (req, res) => {
    const success = await stopBot();
    res.json({ status: success ? 'stopped' : 'error' });
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cleanup on server shutdown
process.on('SIGINT', async () => {
    await stopBot();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await stopBot();
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await stopBot();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (error) => {
    console.error('Unhandled Rejection:', error);
    await stopBot();
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});