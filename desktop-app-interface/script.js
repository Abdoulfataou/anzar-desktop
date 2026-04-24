// Desktop App Interactive Functionality

document.addEventListener('DOMContentLoaded', function() {
    // Tab switching functionality
    const navButtons = document.querySelectorAll('.nav-btn');
    const editorTabs = document.querySelectorAll('.editor-tab');
    
    navButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Remove active class from all nav buttons
            navButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            this.classList.add('active');
            
            // Simulate tab content change (in a real app, this would load different content)
            const tabName = this.getAttribute('data-tab');
            console.log(`Switched to ${tabName} tab`);
            
            // Show a subtle notification
            showNotification(`Switched to ${this.querySelector('span').textContent}`);
        });
    });
    
    editorTabs.forEach(tab => {
        tab.addEventListener('click', function(event) {
            // Don't trigger if clicking the close button
            if (event.target.closest('.tab-close')) return;
            
            // Remove active class from all editor tabs
            editorTabs.forEach(t => t.classList.remove('active'));
            // Add active class to clicked tab
            this.classList.add('active');
            
            // Update breadcrumb
            const fileName = this.textContent.trim().replace('×', '');
            document.querySelector('.breadcrumb .active').textContent = fileName;
            
            // Simulate loading file content (in a real app, this would fetch actual file)
            simulateFileLoad(fileName);
        });
        
        // Close tab functionality
        const closeBtn = tab.querySelector('.tab-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const tabToClose = this.closest('.editor-tab');
                
                // Don't close if it's the last tab or active tab (in a real app, you'd have logic)
                if (document.querySelectorAll('.editor-tab').length > 1 && !tabToClose.classList.contains('active')) {
                    tabToClose.remove();
                    showNotification('Tab closed');
                } else {
                    showNotification('Cannot close the active tab', 'warning');
                }
            });
        }
    });
    
    // Mode switching
    const modeButtons = document.querySelectorAll('.mode-btn');
    modeButtons.forEach(button => {
        button.addEventListener('click', function() {
            modeButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            const mode = this.querySelector('span').textContent;
            showNotification(`Switched to ${mode} mode`);
            
            // Update status indicator
            const statusDot = document.querySelector('.status-dot');
            if (mode === 'Code') {
                statusDot.classList.remove('online');
                setTimeout(() => statusDot.classList.add('online'), 300);
            } else {
                statusDot.classList.remove('online');
                setTimeout(() => statusDot.classList.add('online'), 300);
            }
        });
    });
    
    // Project selection
    const projectItems = document.querySelectorAll('.project-item');
    projectItems.forEach(item => {
        item.addEventListener('click', function() {
            projectItems.forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            
            const projectName = this.querySelector('span').textContent;
            updateBreadcrumb(projectName);
            showNotification(`Project "${projectName}" selected`);
        });
    });
    
    // Search bar functionality
    const searchInput = document.querySelector('.search-bar input');
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && this.value.trim()) {
            showNotification(`Searching for: ${this.value}`, 'info');
            this.value = '';
        }
    });
    
    // Suggestion action handler
    function handleSuggestionAction() {
        const suggestion = this.closest('.suggestion-item');
        const suggestionTitle = suggestion.querySelector('.suggestion-header span').textContent;
        
        // Visual feedback
        this.textContent = 'Applying...';
        this.disabled = true;
        
        setTimeout(() => {
            this.textContent = 'Applied ✓';
            suggestion.style.opacity = '0.7';
            showNotification(`Applied suggestion: ${suggestionTitle}`, 'success');
            
            // Remove after a moment
            setTimeout(() => {
                suggestion.remove();
                // If no suggestions left, show a message
                if (document.querySelectorAll('.suggestion-item').length === 0) {
                    const suggestionList = document.querySelector('.suggestion-list');
                    suggestionList.innerHTML = `
                        <div class="suggestion-item" style="text-align: center; opacity: 0.7;">
                            <p>All suggestions have been applied. SOLO is analyzing your code for more improvements...</p>
                        </div>
                    `;
                }
            }, 1500);
        }, 800);
    }
    
    // Apply suggestion buttons
    const suggestionActions = document.querySelectorAll('.suggestion-action');
    suggestionActions.forEach(button => {
        button.addEventListener('click', handleSuggestionAction);
    });
    
    // Toolbar button actions
    const toolbarButtons = document.querySelectorAll('.toolbar-btn');
    toolbarButtons.forEach(button => {
        button.addEventListener('click', function() {
            const icon = this.querySelector('i');
            if (icon.classList.contains('fa-bell')) {
                // Notification bell
                const badge = this.querySelector('.badge');
                if (badge) {
                    badge.textContent = '0';
                    badge.style.opacity = '0.5';
                    showNotification('Notifications cleared');
                }
            } else if (icon.classList.contains('fa-cog')) {
                showNotification('Settings panel would open here', 'info');
            } else if (icon.classList.contains('fa-user')) {
                showNotification('User profile would open here', 'info');
            } else if (icon.classList.contains('fa-cloud-upload-alt')) {
                showNotification('Sync started...', 'info');
                // Simulate sync animation
                const originalIcon = icon.className;
                icon.className = 'fas fa-spinner fa-spin';
                setTimeout(() => {
                    icon.className = originalIcon;
                    showNotification('Sync completed', 'success');
                }, 2000);
            }
        });
    });
    
    // Content button actions
    document.querySelector('.content-btn:not(.primary)').addEventListener('click', function() {
        showNotification('Running code...', 'info');
        // Simulate running
        const originalText = this.innerHTML;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running...';
        this.disabled = true;
        
        setTimeout(() => {
            this.innerHTML = originalText;
            this.disabled = false;
            showNotification('Code executed successfully', 'success');
        }, 3000);
    });
    
    document.querySelector('.content-btn.primary').addEventListener('click', function() {
        showNotification('Creating new task...', 'info');
        // Simulate task creation
        const taskList = document.querySelector('.task-list');
        const newTask = document.createElement('li');
        newTask.className = 'task-item';
        newTask.innerHTML = `
            <i class="fas fa-plus-circle"></i>
            <div class="task-info">
                <span class="task-name">New task created</span>
                <span class="task-time">Just now</span>
            </div>
        `;
        taskList.prepend(newTask);
        
        // Add click event to new task
        newTask.addEventListener('click', function() {
            document.querySelectorAll('.task-item').forEach(item => item.classList.remove('active'));
            this.classList.add('active');
        });
        
        // Show confirmation
        showNotification('New task created', 'success');
    });
    
    // Footer button actions
    document.querySelectorAll('.footer-btn').forEach(button => {
        button.addEventListener('click', function() {
            if (this.textContent.includes('Chat')) {
                showNotification('Opening chat with SOLO...', 'info');
                // Simulate chat opening
                const editorSidebar = document.querySelector('.editor-sidebar');
                const originalHTML = editorSidebar.innerHTML;
                editorSidebar.innerHTML = `
                    <h3 class="sidebar-title">
                        <i class="fas fa-comment"></i>
                        SOLO Chat
                    </h3>
                    <div class="chat-container" style="margin-top: 20px;">
                        <div class="chat-message solo">
                            <p>Hello! How can I help you with your code today?</p>
                        </div>
                        <div class="chat-input" style="margin-top: 20px;">
                            <input type="text" placeholder="Type your message..." style="width: 100%; padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: white;">
                        </div>
                    </div>
                `;
                
                // Add back button
                const backButton = document.createElement('button');
                backButton.className = 'suggestion-action';
                backButton.textContent = 'Back to suggestions';
                backButton.style.marginTop = '10px';
                backButton.addEventListener('click', function() {
                    editorSidebar.innerHTML = originalHTML;
                    // Rebind suggestion actions
                    document.querySelectorAll('.suggestion-action').forEach(btn => {
                        btn.addEventListener('click', handleSuggestionAction);
                    });
                });
                editorSidebar.querySelector('.chat-container').appendChild(backButton);
                
            } else if (this.textContent.includes('Refresh')) {
                showNotification('Refreshing analysis...', 'info');
                const icon = this.querySelector('i');
                const originalClass = icon.className;
                icon.className = 'fas fa-spinner fa-spin';
                
                setTimeout(() => {
                    icon.className = originalClass;
                    showNotification('Analysis refreshed', 'success');
                }, 1500);
            }
        });
    });
    
    // Sidebar collapse
    document.querySelector('.sidebar-collapse').addEventListener('click', function() {
        const sidebar = document.querySelector('.sidebar');
        const isCollapsed = sidebar.style.width === '0px' || sidebar.style.display === 'none';
        
        if (isCollapsed) {
            sidebar.style.width = '280px';
            sidebar.style.display = 'flex';
            this.innerHTML = '<i class="fas fa-chevron-left"></i>';
        } else {
            sidebar.style.width = '0px';
            sidebar.style.display = 'none';
            this.innerHTML = '<i class="fas fa-chevron-right"></i>';
        }
        
        showNotification(isCollapsed ? 'Sidebar expanded' : 'Sidebar collapsed');
    });
    
    // Simulate live metrics update (like active users increasing)
    simulateLiveMetrics();
    
    // Initialize
    showNotification('SOLO Desktop ready. Agent is active.', 'success');
});

// Helper Functions
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    // Add styles if not already added
    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            .notification {
                position: fixed;
                top: 80px;
                right: 24px;
                background: var(--bg-secondary);
                border-left: 4px solid var(--accent-primary);
                padding: 16px 20px;
                border-radius: var(--radius-md);
                display: flex;
                align-items: center;
                gap: 12px;
                box-shadow: var(--shadow-lg);
                z-index: 1000;
                animation: slideIn 0.3s ease;
                max-width: 350px;
            }
            .notification.success { border-left-color: var(--success); }
            .notification.warning { border-left-color: var(--warning); }
            .notification.info { border-left-color: var(--accent-primary); }
            .notification i { font-size: 18px; }
            .notification.success i { color: var(--success); }
            .notification.warning i { color: var(--warning); }
            .notification.info i { color: var(--accent-primary); }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function updateBreadcrumb(projectName) {
    const breadcrumb = document.querySelector('.breadcrumb');
    breadcrumb.innerHTML = `
        <span>${projectName}</span>
        <i class="fas fa-chevron-right"></i>
        <span>src</span>
        <i class="fas fa-chevron-right"></i>
        <span>components</span>
        <i class="fas fa-chevron-right"></i>
        <span class="active">Dashboard.jsx</span>
    `;
}

function simulateFileLoad(fileName) {
    console.log(`Loading file: ${fileName}`);
    // In a real app, this would fetch file content via API
}

function simulateLiveMetrics() {
    // Simulate active users counter
    const activeUsersEl = document.querySelector('.code-block code');
    if (!activeUsersEl) return;
    
    setInterval(() => {
        const code = activeUsersEl.textContent;
        const regex = /activeUsers: (\d+)/;
        const match = code.match(regex);
        if (match) {
            const current = parseInt(match[1]);
            const newValue = current + Math.floor(Math.random() * 5);
            const updatedCode = code.replace(regex, `activeUsers: ${newValue}`);
            activeUsersEl.textContent = updatedCode;
            // Re-highlight
            if (window.hljs) {
                hljs.highlightElement(activeUsersEl);
            }
        }
    }, 10000);
}

// Add CSS for slideOut animation
const slideOutStyle = document.createElement('style');
slideOutStyle.textContent = `
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(slideOutStyle);