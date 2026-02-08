// Chat Application
class ChatApp {
    constructor() {
        this.messages = [];
        this.currentJobId = null;
        this.isStreaming = false;
        this.chats = []; // Array of chat sessions
        this.currentChatId = null;
        this.deployedResources = []; // Array of deployed resource instances: [{resourceId, driverId, config}, ...]
        this.availableDrivers = {}; // Map of available drivers by id
        
        this.initElements();
        this.loadDrivers().then(() => {
            this.initEventListeners();

            this.autoResizeTextarea();
            this.loadChatHistory();
        });
        
        // Handle browser back/forward buttons
        window.addEventListener('popstate', (e) => {
            this.handleUrlChange();
        });
        
        // Initialize dark mode
        this.initDarkMode();
    }
    
    async loadDrivers() {
        // Define the drivers to load
        const driverList = ['folder'];
        
        for (const driverName of driverList) {
            try {
                // Dynamically import the driver
                const module = await import(`/static/resourcedrivers/${driverName}/${driverName}.js`);
                const driver = module.default || module[Object.keys(module)[0]];
                
                if (driver && driver.metadata) {
                    this.availableDrivers[driver.metadata.id] = driver;
                    // Set app reference on driver for callbacks
                    driver.app = this;
                    console.log(`Loaded driver: ${driver.metadata.name}`);
                }
            } catch (error) {
                console.error(`Failed to load driver ${driverName}:`, error);
            }
        }
        
        // Render available resources
        this.renderAvailableResources();
    }
    
    renderAvailableResources() {
        if (!this.availableResourcesList) return;
        
        const drivers = Object.values(this.availableDrivers);
        
        if (drivers.length === 0) {
            this.availableResourcesList.innerHTML = `
                <div class="text-center text-gray-400 dark:text-gray-500 text-sm py-4">
                    No resources available
                </div>
            `;
            return;
        }
        
        this.availableResourcesList.innerHTML = drivers.map(driver => {
            return `
                <button class="available-resource-btn w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors text-left" data-driver-id="${driver.metadata.id}">
                    ${driver.metadata.icon}
                    <span class="text-sm font-medium">${driver.metadata.name}</span>
                </button>
            `;
        }).join('');
        
        // Add click handlers
        this.availableResourcesList.querySelectorAll('.available-resource-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const driverId = btn.dataset.driverId;
                const driver = this.availableDrivers[driverId];
                if (driver && driver.onAvailableClick) {
                    driver.onAvailableClick();
                }
            });
        });
    }
    
    handleUrlChange() {
        const urlParams = new URLSearchParams(window.location.search);
        const chatId = urlParams.get('chat');
        if (chatId) {
            this.loadChat(chatId);
        } else {
            this.newChat(false); // Don't update URL
        }
    }
    
    updateUrl(chatId) {
        if (chatId) {
            const newUrl = `${window.location.pathname}?chat=${chatId}`;
            window.history.pushState({ chatId }, '', newUrl);
        } else {
            window.history.pushState({}, '', window.location.pathname);
        }
    }
    
    initElements() {
        this.chatMessages = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.newChatBtn = document.getElementById('newChatBtn');
        this.sidebarNewChatBtn = document.getElementById('sidebarNewChatBtn');
        this.modelSelect = document.getElementById('modelSelect');
        this.chatHistoryList = document.getElementById('chatHistoryList');
        this.deployedResourcesList = document.getElementById('deployedResourcesList');
        this.availableResourcesList = document.getElementById('availableResourcesList');
        this.darkModeToggle = document.getElementById('darkModeToggle');
        this.sunIcon = document.getElementById('sunIcon');
        this.moonIcon = document.getElementById('moonIcon');
        this.hljsTheme = document.getElementById('hljs-theme');
    }
    
    async loadChatHistory() {
        // Load chats from server
        try {
            const response = await fetch('/api/chats');
            if (response.ok) {
                const data = await response.json();
                this.chats = data.chats || [];
                this.renderChatHistory();
                
                // Check if there's a chat ID in the URL
                const urlParams = new URLSearchParams(window.location.search);
                const chatId = urlParams.get('chat');
                if (chatId) {
                    const chat = this.chats.find(c => c.id === chatId);
                    if (chat) {
                        // Use loadChat to properly initialize everything including deployed tools
                        this.loadChat(chatId, false); // false = don't update URL
                    } else {
                        // Chat not found, clear URL
                        this.updateUrl(null);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load chat history:', e);
            this.chats = [];
        }
    }
    
    async saveChatToServer(chat) {
        try {
            const response = await fetch(`/api/chats/${chat.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: chat.messages,
                    title: chat.title
                })
            });
            return response.ok;
        } catch (e) {
            console.error('Failed to save chat:', e);
            return false;
        }
    }
    
    async saveDeployedResources() {
        if (!this.currentChatId) return;
        
        // Build deployed_resources object
        const deployedResourcesData = {};
        for (const { resourceId, driverId, config } of this.deployedResources) {
            if (config) {
                deployedResourcesData[resourceId] = config;
            } else {
                const driver = this.availableDrivers[driverId];
                deployedResourcesData[resourceId] = { type: driverId, name: driver?.metadata?.name || driverId };
            }
        }
        
        try {
            const response = await fetch(`/api/chats/${this.currentChatId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deployed_resources: deployedResourcesData })
            });
            
            if (response.ok) {
                console.log('Saved deployed resources:', deployedResourcesData);
            } else {
                console.error('Failed to save deployed resources to server');
            }
        } catch (error) {
            console.error('Error saving deployed resources:', error);
        }
    }
    
    initEventListeners() {
        // Send message
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        // Enter to send (Shift+Enter for new line)
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // New chat buttons
        this.newChatBtn.addEventListener('click', () => this.newChat());
        this.sidebarNewChatBtn.addEventListener('click', () => this.newChat());
        
        // Auto-resize textarea
        this.messageInput.addEventListener('input', () => this.autoResizeTextarea());
        
        // Dark mode toggle
        this.darkModeToggle.addEventListener('click', () => this.toggleDarkMode());
    }
    
    initDarkMode() {
        // Check for saved preference or system preference
        const savedMode = localStorage.getItem('darkMode');
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (savedMode === 'true' || (savedMode === null && systemPrefersDark)) {
            this.enableDarkMode();
        } else {
            this.disableDarkMode();
        }
    }
    
    toggleDarkMode() {
        if (document.documentElement.classList.contains('dark')) {
            this.disableDarkMode();
        } else {
            this.enableDarkMode();
        }
    }
    
    enableDarkMode() {
        document.documentElement.classList.add('dark');
        localStorage.setItem('darkMode', 'true');
        this.updateDarkModeIcons(true);
        this.updateHljsTheme(true);
    }
    
    disableDarkMode() {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('darkMode', 'false');
        this.updateDarkModeIcons(false);
        this.updateHljsTheme(false);
    }
    
    updateDarkModeIcons(isDark) {
        if (isDark) {
            this.sunIcon.classList.remove('hidden');
            this.moonIcon.classList.add('hidden');
        } else {
            this.sunIcon.classList.add('hidden');
            this.moonIcon.classList.remove('hidden');
        }
    }
    
    updateHljsTheme(isDark) {
        if (this.hljsTheme) {
            this.hljsTheme.href = isDark
                ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
                : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
        }
    }
    
    deployResource(resourceId, driverId, config = null) {
        // Check if driver exists
        const driver = this.availableDrivers[driverId];
        if (!driver) {
            console.error(`Driver ${driverId} not found`);
            return;
        }
        
        // Check if already deployed (by resourceId)
        if (this.deployedResources.some(r => r.resourceId === resourceId)) {
            console.log(`Resource ${resourceId} already deployed`);
            return;
        }
        
        // Add the resource instance
        this.deployedResources.push({ resourceId, driverId, config });
        
        this.renderDeployedResources();
    }
    
    renderDeployedResources() {
        if (!this.deployedResourcesList) return;
        
        if (this.deployedResources.length === 0) {
            this.deployedResourcesList.innerHTML = `
                <div class="text-center text-gray-400 dark:text-gray-500 text-sm py-4">
                    No resources deployed
                </div>
            `;
            return;
        }
        
        this.deployedResourcesList.innerHTML = this.deployedResources.map(({ resourceId, driverId, config }) => {
            const driver = this.availableDrivers[driverId];
            if (!driver) return '';
            
            // Use config for display
            const displayName = config?.name || driver.metadata.name;
            const paramText = config?.path ? `<span class="text-xs text-blue-600 dark:text-blue-400 truncate max-w-[150px]">${config.path}</span>` : '';
            
            return `
                <div class="flex flex-col gap-1 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
                    <div class="flex items-center gap-2">
                        ${driver.metadata.icon}
                        <span class="flex-1 truncate text-sm font-medium">${displayName}</span>
                        <button class="undeploy-resource-btn p-1 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded transition-all" data-resource="${resourceId}">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                    ${paramText}
                </div>
            `;
        }).join('');
        
        // Add undeploy handlers
        this.deployedResourcesList.querySelectorAll('.undeploy-resource-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const resourceId = btn.dataset.resource;
                this.undeployResource(resourceId);
            });
        });
    }
    
    undeployResource(resourceId) {
        const resource = this.deployedResources.find(r => r.resourceId === resourceId);
        if (!resource) return;
        
        this.deployedResources = this.deployedResources.filter(r => r.resourceId !== resourceId);
        
        // Call driver's onUndeploy callback with resourceId
        const driver = this.availableDrivers[resource.driverId];
        if (driver && driver.onUndeploy) {
            driver.onUndeploy(resourceId);
        }
        
        this.renderDeployedResources();
    }
    
    renderChatHistory() {
        if (!this.chatHistoryList) return;
        
        if (this.chats.length === 0) {
            this.chatHistoryList.innerHTML = `
                <div class="text-center text-gray-400 dark:text-gray-500 text-sm py-4">
                    No chats yet
                </div>
            `;
            return;
        }
        
        this.chatHistoryList.innerHTML = this.chats.map(chat => {
            const isActive = chat.id === this.currentChatId;
            const title = chat.title || 'New Chat';
            return `
                <div class="chat-history-item group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    isActive 
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }" data-chat-id="${chat.id}">
                    <svg class="w-4 h-4 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                    </svg>
                    <span class="flex-1 truncate text-sm font-medium">${this.escapeHtml(title)}</span>
                    <button class="delete-chat-btn opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 rounded transition-all" data-chat-id="${chat.id}">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');
        
        // Add click handlers
        this.chatHistoryList.querySelectorAll('.chat-history-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.delete-chat-btn')) return;
                const chatId = item.dataset.chatId;
                this.loadChat(chatId);
            });
        });
        
        // Add delete handlers
        this.chatHistoryList.querySelectorAll('.delete-chat-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const chatId = btn.dataset.chatId;
                this.deleteChat(chatId);
            });
        });
    }
    
    async createNewChat() {
        const chat = {
            id: crypto.randomUUID(),
            title: 'New Chat',
            messages: [],
            createdAt: new Date().toISOString()
        };
        this.chats.unshift(chat);
        
        // Save to server
        try {
            await fetch('/api/chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(chat)
            });
        } catch (e) {
            console.error('Failed to create chat on server:', e);
        }
        
        this.renderChatHistory();
        return chat;
    }
    
    loadChat(chatId, updateUrl = true) {
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;
        
        this.currentChatId = chatId;
        this.messages = [...chat.messages];
        
        // Load deployed resources from chat data
        this.deployedResources = [];
        if (chat.deployed_resources) {
            // deployed_resources is an object like { resource_id: { type, name, path, ...params } }
            for (const [resourceId, resourceConfig] of Object.entries(chat.deployed_resources)) {
                const resourceType = resourceConfig?.type;
                if (resourceType && this.availableDrivers[resourceType]) {
                    const driver = this.availableDrivers[resourceType];
                    // Add to deployed resources
                    this.deployedResources.push({
                        resourceId,
                        driverId: resourceType,
                        config: resourceConfig
                    });
                    // Load into driver if it has the method
                    if (driver.loadDeployedResources) {
                        driver.loadDeployedResources({ [resourceId]: resourceConfig });
                    }
                }
            }
        }
        this.renderDeployedResources();
        
        this.renderMessages();
        this.renderChatHistory();
        
        // Update URL
        if (updateUrl) {
            this.updateUrl(chatId);
        }
    }
    
    renderMessages() {
        this.chatMessages.innerHTML = '';
        
        if (this.messages.length === 0) {
            // Show welcome message
            this.chatMessages.innerHTML = `
                <div class="flex gap-4 max-w-4xl mx-auto">
                    <div class="w-8 h-8 bg-gradient-to-br from-green-500 to-teal-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                        </svg>
                    </div>
                    <div class="flex-1">
                        <div class="font-medium text-gray-900 dark:text-white mb-1">Assistant</div>
                        <div class="message-content text-gray-700 dark:text-gray-300">
                            <p>Hello! I'm ready to help. Send me a message to start chatting.</p>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Render all messages
            this.messages.forEach(msg => {
                this.addMessage(msg.role, msg.content, false, false);
            });
        }
        this.scrollToBottom();
    }
    
    async deleteChat(chatId) {
        this.chats = this.chats.filter(c => c.id !== chatId);
        
        // Delete from server
        try {
            await fetch(`/api/chats/${chatId}`, {
                method: 'DELETE'
            });
        } catch (e) {
            console.error('Failed to delete chat from server:', e);
        }
        
        if (this.currentChatId === chatId) {
            this.currentChatId = null;
            this.messages = [];
            this.renderMessages();
        }
        
        this.renderChatHistory();
    }
    
    async updateCurrentChat() {
        if (!this.currentChatId) return;
        
        const chat = this.chats.find(c => c.id === this.currentChatId);
        if (chat) {
            chat.messages = [...this.messages];
            // Update title based on first user message
            const firstUserMessage = this.messages.find(m => m.role === 'user');
            if (firstUserMessage) {
                chat.title = firstUserMessage.content.substring(0, 30) + (firstUserMessage.content.length > 30 ? '...' : '');
            }
            
            // Save to server
            await this.saveChatToServer(chat);
            this.renderChatHistory();
        }
    }
    
    autoResizeTextarea() {
        this.messageInput.style.height = 'auto';
        this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 128) + 'px';
    }
    
    async sendMessage() {
        const content = this.messageInput.value.trim();
        if (!content || this.isStreaming) return;
        
        // Create a new chat if none exists
        if (!this.currentChatId) {
            const chat = await this.createNewChat();
            this.currentChatId = chat.id;
        }
        
        // Add user message
        this.addMessage('user', content);
        this.messages.push({ role: 'user', content });
        this.updateCurrentChat();
        
        // Clear input
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';
        
        // Disable send button
        this.isStreaming = true;
        this.sendBtn.disabled = true;
        
        try {
            // Build deployed_resources object from deployed resources
            const deployedResourcesData = {};
            for (const { resourceId, driverId, config } of this.deployedResources) {
                if (config) {
                    deployedResourcesData[resourceId] = config;
                } else {
                    const driver = this.availableDrivers[driverId];
                    deployedResourcesData[resourceId] = { type: driverId, name: driver?.metadata?.name || driverId };
                }
            }
            
            // Submit job
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: this.messages,
                    model: this.modelSelect.value,
                    temperature: 1.0,
                    deployed_resources: deployedResourcesData
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to submit chat');
            }
            
            const data = await response.json();
            this.currentJobId = data.job_id;
            
            // Start streaming
            await this.streamResponse(this.currentJobId);
            
        } catch (error) {
            console.error('Error:', error);
            this.addMessage('assistant', `Error: ${error.message}`);
            this.isStreaming = false;
            this.sendBtn.disabled = false;
        }
    }
    
    async streamResponse(jobId) {
        // Create assistant message placeholder
        const messageDiv = this.addMessage('assistant', '', true);
        const contentDiv = messageDiv.querySelector('.message-content');
        
        let fullContent = '';
        
        try {
            const eventSource = new EventSource(`/stream/${jobId}`);
            
            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (event.lastEventId === 'error') {
                    contentDiv.innerHTML = `<span class="text-red-500">Error: ${data.error}</span>`;
                    eventSource.close();
                    this.finishStreaming();
                    return;
                }
                
                fullContent += data.content;
                contentDiv.innerHTML = this.renderMarkdown(fullContent);
                this.highlightCode();
                this.scrollToBottom();
            };
            
            eventSource.addEventListener('chunk', (event) => {
                const data = JSON.parse(event.data);
                fullContent += data.content;
                contentDiv.innerHTML = this.renderMarkdown(fullContent);
                this.highlightCode();
                this.scrollToBottom();
            });
            
            eventSource.addEventListener('done', () => {
                eventSource.close();
                this.messages.push({ role: 'assistant', content: fullContent });
                this.updateCurrentChat();
                this.finishStreaming();
            });
            
            eventSource.addEventListener('error', (event) => {
                const data = JSON.parse(event.data);
                contentDiv.innerHTML = `<span class="text-red-500">Error: ${data.error}</span>`;
                eventSource.close();
                this.finishStreaming();
            });
            
            eventSource.onerror = () => {
                eventSource.close();
                this.finishStreaming();
            };
            
        } catch (error) {
            console.error('Streaming error:', error);
            contentDiv.innerHTML = `<span class="text-red-500">Error: ${error.message}</span>`;
            this.finishStreaming();
        }
    }
    
    finishStreaming() {
        this.isStreaming = false;
        this.sendBtn.disabled = false;
        this.currentJobId = null;
    }
    
    addMessage(role, content, isStreaming = false, append = true) {
        const div = document.createElement('div');
        div.className = 'flex gap-4 max-w-4xl mx-auto animate-fade-in';
        
        const isUser = role === 'user';
        const avatarBg = isUser 
            ? 'bg-gradient-to-br from-blue-500 to-indigo-600' 
            : 'bg-gradient-to-br from-green-500 to-teal-600';
        const avatarIcon = isUser
            ? `<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>`
            : `<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>`;
        
        const displayContent = isUser 
            ? this.escapeHtml(content) 
            : (isStreaming ? '<span class="typing-indicator"></span>' : this.renderMarkdown(content));
        
        div.innerHTML = `
            <div class="w-8 h-8 ${avatarBg} rounded-full flex items-center justify-center flex-shrink-0">
                ${avatarIcon}
            </div>
            <div class="flex-1 min-w-0">
                <div class="font-medium text-gray-900 dark:text-white mb-1">${isUser ? 'You' : 'Assistant'}</div>
                <div class="message-content text-gray-700 dark:text-gray-300 prose dark:prose-invert max-w-none">
                    ${displayContent}
                </div>
            </div>
        `;
        
        if (append) {
            this.chatMessages.appendChild(div);
            this.scrollToBottom();
        } else {
            this.chatMessages.appendChild(div);
        }
        
        if (!isUser) {
            this.highlightCode();
        }
        
        return div;
    }
    
    renderMarkdown(content) {
        if (!content) return '';
        
        // Configure marked
        marked.setOptions({
            highlight: function(code, lang) {
                if (lang && hljs.getLanguage(lang)) {
                    return hljs.highlight(code, { language: lang }).value;
                }
                return hljs.highlightAuto(code).value;
            },
            breaks: true,
            gfm: true
        });
        
        return marked.parse(content);
    }
    
    highlightCode() {
        document.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
    
    newChat(updateUrl = true) {
        this.messages = [];
        this.currentChatId = null;
        
        // Clear deployed resources
        this.deployedResources = [];
        this.renderDeployedResources();
        
        this.chatMessages.innerHTML = `
            <div class="flex gap-4 max-w-4xl mx-auto">
                <div class="w-8 h-8 bg-gradient-to-br from-green-500 to-teal-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                    </svg>
                </div>
                <div class="flex-1">
                    <div class="font-medium text-gray-900 dark:text-white mb-1">Assistant</div>
                    <div class="message-content text-gray-700 dark:text-gray-300">
                        <p>Hello! I'm ready to help. Send me a message to start chatting.</p>
                    </div>
                </div>
            </div>
        `;
        this.renderChatHistory();
        this.finishStreaming();
        
        // Clear URL
        if (updateUrl) {
            this.updateUrl(null);
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});
