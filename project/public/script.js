let isRunning = false;
const button = document.getElementById('toggleBot');
const status = document.getElementById('status');

async function startBot() {
    try {
        const response = await fetch('/api/start', {
            method: 'POST'
        });
        const data = await response.json();
        return data.status === 'started';
    } catch (error) {
        console.error('Error starting bot:', error);
        return false;
    }
}

async function stopBot() {
    try {
        const response = await fetch('/api/stop', {
            method: 'POST'
        });
        const data = await response.json();
        return data.status === 'stopped';
    } catch (error) {
        console.error('Error stopping bot:', error);
        return false;
    }
}

button.addEventListener('click', async () => {
    let success;
    
    if (!isRunning) {
        success = await startBot();
    } else {
        success = await stopBot();
    }
    
    if (success) {
        isRunning = !isRunning;
        if (isRunning) {
            button.textContent = 'إيقاف البوت';
            button.classList.add('active');
            status.textContent = 'البوت يعمل الآن';
        } else {
            button.textContent = 'تشغيل البوت';
            button.classList.remove('active');
            status.textContent = 'البوت متوقف';
        }
    } else {
        status.textContent = 'حدث خطأ في تشغيل/إيقاف البوت';
    }
});