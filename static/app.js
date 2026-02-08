// Chat Application
class ChatApp {
    constructor() {
        this.messages = [];
        this.currentJobId = null;
        this.isStreaming = false;
        this.chats = []; // Array of chat sessions
        this.currentChatId = null;
        this.deployedTools = []; // Array of deployed tools
        this.availablePlugins = {}; // Map of available plugins by id
        
        this.initElements();
        this.loadPlugins().then(() => {
            this.initEventListeners();
            this.loadModels();
            this.autoResizeTextarea();
            this.loadChatHistory();
        });
        
        // Handle browser back/forward buttons
        window.addEventListener('popstate', (e) => {
            this.handleUrlChange();
        });
    }
    
    async loadPlugins() {
        // Define the plugins to load
        const pluginList = ['folder'];
        
        for (const pluginName of pluginList) {
            try {
                // Dynamically import the plugin
                const module = await import(`/static/plugins/${pluginName}/${pluginName}.js`);
                const plugin = module.default || module[Object.keys(module)[0]];
                
                if (plugin && plugin.metadata) {
                    this.availablePlugins[plugin.metadata.id] = plugin;
                    // Set app reference on plugin for callbacks
                    plugin.app = this;
                    console.log(`Loaded plugin: ${plugin.metadata.name}`);
                }
            } catch (error) {
                console.error(`Failed to load plugin ${pluginName}:`, error);
            }
        }
        
        // Render available tools
        this.renderAvailableTools();
    }
    
    renderAvailableTools() {
        if (!this.availableToolsList) return;
        
        const plugins = Object.values(this.availablePlugins);
        
        if (plugins.length === 0) {
            this.availableToolsList.innerHTML = `
                <div class="text-center text-gray-400 dark:text-gray-500 text-sm py-4">
                    No tools available
                </div>
            `;
            return;
        }
        
        this.availableToolsList.innerHTML = plugins.map(plugin => {
            return `
                <button class="available-tool-btn w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors text-left" data-plugin-id="${plugin.metadata.id}">
                    ${plugin.metadata.icon}
                    <span class="text-sm font-medium">${plugin.metadata.name}</span>
                </button>
            `;
        }).join('');
        
        // Add click handlers
        this.availableToolsList.querySelectorAll('.available-tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pluginId = btn.dataset.pluginId;
                const plugin = this.availablePlugins[pluginId];
                if (plugin && plugin.onAvailableClick) {
                    plugin.onAvailableClick();
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
        this.deployedToolsList = document.getElementById('deployedToolsList');
        this.availableToolsList = document.getElementById('availableToolsList');
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
    }
    
    deployTool(pluginId) {
        // Check if plugin exists
        const plugin = this.availablePlugins[pluginId];
        if (!plugin) {
            console.error(`Plugin ${pluginId} not found`);
            return;
        }
        
        // Check if already deployed
        if (this.deployedTools.includes(pluginId)) {
            console.log(`${plugin.metadata.name} tool already deployed`);
            return;
        }
        
        this.deployedTools.push(pluginId);
        
        // Call plugin's onDeploy callback
        if (plugin.onDeploy) {
            plugin.onDeploy();
        }
        
        this.renderDeployedTools();
    }
    
    renderDeployedTools() {
        if (!this.deployedToolsList) return;
        
        if (this.deployedTools.length === 0) {
            this.deployedToolsList.innerHTML = `
                <div class="text-center text-gray-400 dark:text-gray-500 text-sm py-4">
                    No tools deployed
                </div>
            `;
            return;
        }
        
        this.deployedToolsList.innerHTML = this.deployedTools.map(pluginId => {
            const plugin = this.availablePlugins[pluginId];
            if (!plugin) return '';
            
            // Get tool config to display params (e.g., folder path)
            const config = plugin.getToolConfig ? plugin.getToolConfig() : { name: plugin.metadata.name };
            const displayName = config.name || plugin.metadata.name;
            const paramText = config.path ? `<span class="text-xs text-blue-600 dark:text-blue-400 truncate max-w-[150px]">${config.path}</span>` : '';
            
            return `
                <div class="flex flex-col gap-1 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
                    <div class="flex items-center gap-2">
                        ${plugin.metadata.icon}
                        <span class="flex-1 truncate text-sm font-medium">${displayName}</span>
                        <button class="undeploy-tool-btn p-1 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded transition-all" data-tool="${pluginId}">
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
        this.deployedToolsList.querySelectorAll('.undeploy-tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tool = btn.dataset.tool;
                this.undeployTool(tool);
            });
        });
    }
    
    undeployTool(pluginId) {
        this.deployedTools = this.deployedTools.filter(t => t !== pluginId);
        
        // Call plugin's onUndeploy callback
        const plugin = this.availablePlugins[pluginId];
        if (plugin && plugin.onUndeploy) {
            plugin.onUndeploy();
        }
        
        this.renderDeployedTools();
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
        
        // Load deployed tools from chat data
        this.deployedTools = [];
        if (chat.deployed_tools) {
            // deployed_tools is an object like { tool_id: { name, ...params } }
            for (const [toolId, toolConfig] of Object.entries(chat.deployed_tools)) {
                if (this.availablePlugins[toolId]) {
                    this.deployedTools.push(toolId);
                    // Call onDeploy for each loaded tool
                    const plugin = this.availablePlugins[toolId];
                    if (plugin.onDeploy) {
                        plugin.onDeploy();
                    }
                }
            }
        }
        this.renderDeployedTools();
        
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
    
    async loadModels() {
        try {
            const response = await fetch('/models');
            const data = await response.json();
            
            if (data.data && data.data.length > 0) {
                this.modelSelect.innerHTML = data.data
                    .map(m => `<option value="${m.id}">${m.id}</option>`)
                    .join('');
            }
        } catch (error) {
            console.error('Failed to load models:', error);
        }
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
            // Build deployed_tools object from deployed tools
            const deployedToolsData = {};
            for (const pluginId of this.deployedTools) {
                const plugin = this.availablePlugins[pluginId];
                if (plugin && plugin.getToolConfig) {
                    deployedToolsData[pluginId] = plugin.getToolConfig();
                } else {
                    deployedToolsData[pluginId] = { name: plugin.metadata.name };
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
                    deployed_tools: deployedToolsData
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
        
        // Clear deployed tools
        this.deployedTools = [];
        this.renderDeployedTools();
        
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
