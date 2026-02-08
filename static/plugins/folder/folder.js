/**
 * Folder Plugin
 * A tool for browsing and managing folders
 */

const FolderPlugin = {
    // Metadata
    metadata: {
        id: 'folder',
        name: 'Folder',
        description: 'Browse and manage folders',
        version: '1.0.0',
        icon: `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
        </svg>`
    },

    // Reference to the ChatApp instance (set by app.js)
    app: null,

    // Store the current folder configuration
    currentConfig: null,

    // Show modal dialog for folder path input
    showFolderInputModal: function() {
        return new Promise((resolve) => {
            // Create modal overlay
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
            overlay.innerHTML = `
                <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
                    <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                        Enter Folder Path
                    </h3>
                    <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Please copy and paste the full path to your folder:<br>
                        <span class="text-xs text-gray-500 dark:text-gray-500">
                            (e.g., C:\\Users\\Name\\Documents\\MyFolder or /home/user/projects/myfolder)
                        </span>
                    </p>
                    <input 
                        type="text" 
                        id="folderPathInput" 
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                               bg-white dark:bg-gray-700 text-gray-900 dark:text-white 
                               focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                        placeholder="Paste full folder path here..."
                        autofocus
                    >
                    <div class="flex justify-end gap-2">
                        <button id="cancelFolderBtn" class="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                            Cancel
                        </button>
                        <button id="confirmFolderBtn" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                            Add Folder
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            const input = overlay.querySelector('#folderPathInput');
            const confirmBtn = overlay.querySelector('#confirmFolderBtn');
            const cancelBtn = overlay.querySelector('#cancelFolderBtn');
            
            // Handle confirm
            const handleConfirm = () => {
                const path = input.value.trim();
                document.body.removeChild(overlay);
                if (path) {
                    // Extract folder name from path
                    const pathParts = path.replace(/\\/g, '/').split('/').filter(p => p);
                    const name = pathParts[pathParts.length - 1] || path;
                    resolve({ name, path });
                } else {
                    resolve(null);
                }
            };
            
            // Handle cancel
            const handleCancel = () => {
                document.body.removeChild(overlay);
                resolve(null);
            };
            
            // Event listeners
            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') handleCancel();
            });
            
            // Focus input
            setTimeout(() => input.focus(), 100);
        });
    },

    // Called when the available tool button is clicked
    onAvailableClick: async function() {
        try {
            // Show modal to get folder path from user
            const folderData = await this.showFolderInputModal();
            
            if (!folderData) {
                console.log('Folder selection cancelled');
                return null;
            }
            
            console.log('Folder path entered:', folderData);
            
            // Deploy the tool if a path was entered and app reference exists
            if (this.app) {
                // Store the config locally
                this.currentConfig = folderData;
                
                // Deploy the tool visually
                this.app.deployTool(this.metadata.id);
                
                // Save to server if we have a current chat
                if (this.app.currentChatId) {
                    const deployedTools = {
                        [this.metadata.id]: folderData
                    };
                    
                    try {
                        const response = await fetch(`/api/chats/${this.app.currentChatId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ deployed_tools: deployedTools })
                        });
                        
                        if (response.ok) {
                            console.log(`Saved deployed tool ${this.metadata.id}:`, folderData);
                        } else {
                            console.error('Failed to save deployed tool to server');
                        }
                    } catch (error) {
                        console.error('Error saving deployed tool:', error);
                    }
                }
            }
            
            return folderData;
        } catch (error) {
            console.error('Error in folder selection:', error);
            return null;
        }
    },

    // Called when the tool is deployed (added to deployed tools)
    onDeploy: function() {
        console.log('Folder tool deployed');
        // Try to load config from chat if not already set
        if (!this.currentConfig && this.app && this.app.currentChatId) {
            const chat = this.app.chats.find(c => c.id === this.app.currentChatId);
            if (chat && chat.deployed_tools && chat.deployed_tools[this.metadata.id]) {
                this.currentConfig = chat.deployed_tools[this.metadata.id];
            }
        }
    },

    // Called when the tool is undeployed (removed from deployed tools)
    onUndeploy: function() {
        console.log('Folder tool undeployed');
        this.currentConfig = null;
    },

    // Get the current tool configuration for the backend
    getToolConfig: function() {
        // First check local config (set during deployment)
        if (this.currentConfig) {
            return this.currentConfig;
        }
        
        // Try to get the saved config from the current chat
        if (this.app && this.app.currentChatId) {
            const chat = this.app.chats.find(c => c.id === this.app.currentChatId);
            if (chat && chat.deployed_tools && chat.deployed_tools[this.metadata.id]) {
                return chat.deployed_tools[this.metadata.id];
            }
        }
        // Return default config if not found
        return { name: this.metadata.name, path: null };
    }
};

// ES Module export
export default FolderPlugin;
