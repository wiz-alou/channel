#!/bin/bash

# Thunder Payment Channel - Installation Script
echo "⚡ Installing Thunder Payment Channel..."

# Create bin directory
mkdir -p bin

# Create thunderd.js wrapper
cat > bin/thunderd.js << 'EOF'
#!/usr/bin/env node

/**
 * Thunder Payment Channel Node
 * Global executable wrapper
 */

const path = require('path');
const { spawn } = require('child_process');

// Get the installation directory
const installDir = path.dirname(path.dirname(__filename));

// Launch thunderd with correct paths
const thunderd = spawn('node', [path.join(installDir, 'src', 'thunderd.js'), ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: installDir
});

thunderd.on('exit', (code) => {
    process.exit(code);
});
EOF

# Create thunder-cli.js wrapper
cat > bin/thunder-cli.js << 'EOF'
#!/usr/bin/env node

/**
 * Thunder Payment Channel CLI
 * Global executable wrapper
 */

const path = require('path');
const { spawn } = require('child_process');

// Get the installation directory
const installDir = path.dirname(path.dirname(__filename));

// Launch thunder-cli with correct paths
const thunderCli = spawn('node', [path.join(installDir, 'src', 'thunder-cli.js'), ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: installDir
});

thunderCli.on('exit', (code) => {
    process.exit(code);
});
EOF

# Make files executable
chmod +x bin/thunderd.js
chmod +x bin/thunder-cli.js

# Add shebang to main files if not present
if ! head -1 src/thunderd.js | grep -q "#!/usr/bin/env node"; then
    sed -i '1i#!/usr/bin/env node' src/thunderd.js
fi

if ! head -1 src/thunder-cli.js | grep -q "#!/usr/bin/env node"; then
    sed -i '1i#!/usr/bin/env node' src/thunder-cli.js
fi

chmod +x src/thunderd.js
chmod +x src/thunder-cli.js

echo "✅ Installation files created"
echo ""
echo "To install globally:"
echo "  npm install -g ."
echo ""
echo "To install locally with symlinks:"
echo "  sudo ln -s $(pwd)/bin/thunderd.js /usr/local/bin/thunderd"
echo "  sudo ln -s $(pwd)/bin/thunder-cli.js /usr/local/bin/thunder-cli"
echo ""
echo "After installation, use:"
echo "  thunderd --port 2002"
echo "  thunder-cli infos"
echo "  thunder-cli balance"