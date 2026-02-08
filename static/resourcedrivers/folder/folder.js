/**
 * Folder Driver
 * A tool for browsing and managing folders
 */

const FolderDriver = {
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

    // Reference to the ChatApp instance (set by app.js during driver loading)
    app: null,

    // Store deployed folder instances: [{ resourceId, config }, ...]
    deployedInstances: [],

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
                // Generate a unique resource ID
                const resourceId = `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                // Store the config with type and resource ID
                const config = {
                    ...folderData,
                    type: 'folder',
                    resource_id: resourceId
                };
                
                // Add to deployed instances
                this.deployedInstances.push({ resourceId, config });
                
                // Deploy the resource visually
                this.app.deployResource(resourceId, this.metadata.id, config);
                
                // Save to server if we have a current chat
                if (this.app.currentChatId && this.app.saveDeployedResources) {
                    await this.app.saveDeployedResources();
                }
            }
            
            return folderData;
        } catch (error) {
            console.error('Error in folder selection:', error);
            return null;
        }
    },

    // Called when a resource instance is undeployed (removed from deployed resources)
    onUndeploy: function(resourceId) {
        console.log('Folder resource undeployed:', resourceId);
        // Remove from deployed instances
        this.deployedInstances = this.deployedInstances.filter(inst => inst.resourceId !== resourceId);
    },
    
    // Called when loading a chat with saved deployed resources
    loadDeployedResources: function(deployedResources) {
        this.deployedInstances = [];
        // deployedResources is an object like { resourceId: { type, name, path, resource_id } }
        for (const [resourceId, config] of Object.entries(deployedResources)) {
            if (config.type === 'folder') {
                this.deployedInstances.push({ resourceId, config });
            }
        }
        return this.deployedInstances.length;
    },

    // Get all deployed resource configurations for the backend
    getAllToolConfigs: function() {
        const configs = {};
        this.deployedInstances.forEach(inst => {
            configs[inst.resourceId] = inst.config;
        });
        return configs;
    },
    
    // Get a single resource configuration (for backward compatibility)
    getToolConfig: function(resourceId) {
        const instance = this.deployedInstances.find(inst => inst.resourceId === resourceId);
        return instance ? instance.config : null;
    }
};

// ES Module export
export default FolderDriver;
