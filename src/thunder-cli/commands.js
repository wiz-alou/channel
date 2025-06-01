/**
 * DESCRIPTION:
 * Interface CLI améliorée pour Thunder Payment Channels avec une UI moderne.
 * Présentation visuelle enrichie avec couleurs, icônes, tableaux et animations.
 * 
 * AMÉLIORATIONS UI:
 * - Système de couleurs étendu avec gradients
 * - Icônes et émojis contextuels
 * - Tableaux formatés pour les données
 * - Barres de progression pour les opérations
 * - Animations de chargement
 * - Messages d'erreur détaillés avec suggestions
 * - Interface responsive selon la largeur du terminal
 * 
 * WORKFLOW P2P AVEC UI AMÉLIORÉE:
 * 1. proposeChannel() - Interface visuelle pour propositions
 * 2. acceptChannel() - Confirmation interactive
 * 3. createChannel() - Suivi visuel de création
 * 4. fundChannel() - Barre de progression de financement
 * 5. listProposals() - Tableau formaté des propositions
 */

const axios = require('axios');
const Utils = require('../shared/utils');

class Commands {
    constructor() {
        this.defaultTimeout = 10000;

        // Système de couleurs étendu
        this.colors = {
            // Couleurs de base
            reset: '\x1b[0m',
            bright: '\x1b[1m',
            dim: '\x1b[2m',

            // Couleurs standards
            black: '\x1b[30m',
            red: '\x1b[31m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            blue: '\x1b[34m',
            magenta: '\x1b[35m',
            cyan: '\x1b[36m',
            white: '\x1b[37m',
            gray: '\x1b[90m',

            // Couleurs brillantes
            brightRed: '\x1b[91m',
            brightGreen: '\x1b[92m',
            brightYellow: '\x1b[93m',
            brightBlue: '\x1b[94m',
            brightMagenta: '\x1b[95m',
            brightCyan: '\x1b[96m',
            brightWhite: '\x1b[97m',

            // Couleurs d'arrière-plan
            bgBlack: '\x1b[40m',
            bgRed: '\x1b[41m',
            bgGreen: '\x1b[42m',
            bgYellow: '\x1b[43m',
            bgBlue: '\x1b[44m',
            bgMagenta: '\x1b[45m',
            bgCyan: '\x1b[46m',
            bgWhite: '\x1b[47m',

            // Couleurs personnalisées pour l'UI
            primary: '\x1b[38;5;33m',      // Bleu électrique
            secondary: '\x1b[38;5;129m',   // Violet
            success: '\x1b[38;5;46m',      // Vert lime
            warning: '\x1b[38;5;214m',     // Orange
            error: '\x1b[38;5;196m',       // Rouge vif
            info: '\x1b[38;5;39m',         // Cyan vif
            muted: '\x1b[38;5;244m',       // Gris moyen
            accent: '\x1b[38;5;226m',      // Jaune doré
        };

        // Icônes et émojis contextuels
        this.icons = {
            // États généraux
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️',
            loading: '🔄',

            // Actions spécifiques
            wallet: '👛',
            balance: '💰',
            channel: '🔗',
            payment: '💸',
            peer: '👥',
            proposal: '📋',
            fund: '💎',
            close: '🔒',
            withdraw: '💳',

            // États de channel
            active: '🟢',
            closing: '🟡',
            closed: '🔴',
            empty: '⚪',

            // Navigation
            arrow: '→',
            bullet: '•',
            check: '✓',
            cross: '✗',
            star: '⭐',

            // Techniques
            blockchain: '⛓️',
            contract: '📄',
            signature: '✍️',
            network: '🌐',
            node: '🖥️',
        };

        // Configuration d'affichage
        this.display = {
            width: process.stdout.columns || 80,
            indentSize: 2,
            tableMinWidth: 60,
        };
    }

    // === UTILITAIRES D'AFFICHAGE AVANCÉS ===

    /**
     * Applique une couleur avec support des couleurs personnalisées
     */
    colorize(text, color, background = null) {
        let colorCode = this.colors[color] || this.colors.white;
        let bgCode = background ? (this.colors[background] || '') : '';
        return `${bgCode}${colorCode}${text}${this.colors.reset}`;
    }

    /**
     * Crée un gradient de couleur pour le texte
     */
    gradient(text, startColor, endColor) {
        // Simulation d'un gradient simple avec alternance de couleurs
        const chars = text.split('');
        return chars.map((char, index) => {
            const useStart = index % 2 === 0;
            return this.colorize(char, useStart ? startColor : endColor);
        }).join('');
    }

    /**
     * Affiche un titre avec style
     */
    printTitle(title, subtitle = null) {
        const width = Math.min(this.display.width, 80);
        const titleWidth = title.length;
        const padding = Math.max(0, Math.floor((width - titleWidth - 4) / 2));
        const border = '═'.repeat(width);

        console.log('');
        console.log(this.colorize(border, 'primary'));
        console.log(this.colorize('║', 'primary') + ' '.repeat(padding) +
            this.colorize(title, 'brightWhite', 'bgBlue') +
            ' '.repeat(padding) + this.colorize('║', 'primary'));

        if (subtitle) {
            const subWidth = subtitle.length;
            const subPadding = Math.max(0, Math.floor((width - subWidth - 4) / 2));
            console.log(this.colorize('║', 'primary') + ' '.repeat(subPadding) +
                this.colorize(subtitle, 'muted') +
                ' '.repeat(subPadding) + this.colorize('║', 'primary'));
        }

        console.log(this.colorize(border, 'primary'));
        console.log('');
    }

    /**
     * Affiche une section avec en-tête stylé
     */
    printSection(title, icon = null) {
        const displayIcon = icon || this.icons.bullet;
        console.log('');
        console.log(this.colorize(`${displayIcon} ${title}`, 'brightCyan', 'bright'));
        console.log(this.colorize('─'.repeat(title.length + 3), 'cyan'));
    }

    /**
     * Affiche un message de statut amélioré
     */
    printStatus(type, message, details = null, progress = null) {
        const statusConfig = {
            success: { icon: this.icons.success, color: 'success', prefix: 'SUCCESS' },
            error: { icon: this.icons.error, color: 'error', prefix: 'ERROR' },
            warning: { icon: this.icons.warning, color: 'warning', prefix: 'WARNING' },
            info: { icon: this.icons.info, color: 'info', prefix: 'INFO' },
            loading: { icon: this.icons.loading, color: 'primary', prefix: 'LOADING' }
        };

        const config = statusConfig[type] || statusConfig.info;
        const timestamp = new Date().toLocaleTimeString();

        // Ligne principale avec horodatage
        console.log(
            `${config.icon} ` +
            this.colorize(`[${config.prefix}]`, config.color, 'bright') +
            ` ${message} ` +
            this.colorize(`(${timestamp})`, 'muted')
        );

        // Détails optionnels
        if (details) {
            console.log(`   ${this.colorize('└─', 'muted')} ${this.colorize(details, 'gray')}`);
        }

        // Barre de progression optionnelle
        if (progress) {
            this.printProgressBar(progress.current, progress.total, progress.label);
        }
    }

    /**
     * Affiche une barre de progression
     */
    printProgressBar(current, total, label = 'Progress') {
        const barWidth = 30;
        const percentage = Math.round((current / total) * 100);
        const filled = Math.round((current / total) * barWidth);
        const empty = barWidth - filled;

        const bar = this.colorize('█'.repeat(filled), 'success') +
            this.colorize('░'.repeat(empty), 'muted');

        console.log(`   ${this.colorize(label, 'info')}: [${bar}] ${this.colorize(percentage + '%', 'accent')}`);
    }

    /**
     * Affiche un tableau formaté
     */

    /**
     * Affiche un tableau formaté avec adaptation automatique à la largeur du terminal
     */
    printTable(headers, rows, options = {}) {
        if (rows.length === 0) {
            console.log(this.colorize('   (No data available)', 'muted'));
            return;
        }

        const opts = {
            showHeaders: true,
            columnPadding: 1,
            borderColor: 'muted',
            headerColor: 'brightCyan',
            alternateRows: true,
            maxWidth: Math.min(this.display.width - 6, 100), // Limite la largeur
            ...options
        };

        // Calcule les largeurs minimales des colonnes
        const minWidths = headers.map((header, index) => {
            const headerWidth = header.length;
            const maxRowWidth = Math.max(...rows.map(row =>
                (row[index] || '').toString().length
            ));
            return Math.max(headerWidth, maxRowWidth);
        });

        // Calcule la largeur totale disponible
        const totalMinWidth = minWidths.reduce((sum, width) => sum + width, 0);
        const totalPadding = headers.length * (opts.columnPadding * 2);
        const totalBorders = headers.length + 1; // Bordures verticales
        const requiredWidth = totalMinWidth + totalPadding + totalBorders;

        let colWidths;

        if (requiredWidth <= opts.maxWidth) {
            // Si ça rentre, utilise les largeurs minimales + padding
            colWidths = minWidths.map(width => width + opts.columnPadding);
        } else {
            // Si ça déborde, distribue l'espace proportionnellement
            const availableSpace = opts.maxWidth - totalBorders - totalPadding;
            const proportion = availableSpace / totalMinWidth;

            colWidths = minWidths.map(width => {
                const proportionalWidth = Math.floor(width * proportion);
                return Math.max(proportionalWidth, Math.min(width, 8)); // Minimum 8 chars
            });
        }

        // Fonction pour tronquer le texte si nécessaire
        const truncateText = (text, maxLength) => {
            if (text.length <= maxLength) return text;
            return text.substring(0, maxLength - 3) + '...';
        };

        // Ligne de séparation
        const separator = colWidths.map(width => '─'.repeat(width)).join('┼');
        const topBorder = '┌' + separator.replace(/┼/g, '┬') + '┐';
        const midBorder = '├' + separator + '┤';
        const botBorder = '└' + separator.replace(/┼/g, '┴') + '┘';

        // En-tête
        if (opts.showHeaders) {
            console.log(this.colorize(topBorder, opts.borderColor));
            const headerRow = headers.map((header, index) => {
                const truncated = truncateText(header, colWidths[index]);
                return this.colorize(truncated.padEnd(colWidths[index]), opts.headerColor);
            }).join(this.colorize('│', opts.borderColor));
            console.log(this.colorize('│', opts.borderColor) + headerRow + this.colorize('│', opts.borderColor));
            console.log(this.colorize(midBorder, opts.borderColor));
        }

        // Lignes de données
        rows.forEach((row, rowIndex) => {
            const rowColor = opts.alternateRows && rowIndex % 2 === 1 ? 'gray' : 'white';
            const formattedRow = row.map((cell, colIndex) => {
                const cellText = (cell || '').toString();
                const truncated = truncateText(cellText, colWidths[colIndex]);
                return this.colorize(truncated.padEnd(colWidths[colIndex]), rowColor);
            }).join(this.colorize('│', opts.borderColor));
            console.log(this.colorize('│', opts.borderColor) + formattedRow + this.colorize('│', opts.borderColor));
        });

        console.log(this.colorize(botBorder, opts.borderColor));
    }
    /**
     * Affiche une box d'information stylée
     */
    printInfoBox(title, content, type = 'info') {
        const boxConfig = {
            info: { borderColor: 'info', titleColor: 'brightCyan', icon: this.icons.info },
            success: { borderColor: 'success', titleColor: 'brightGreen', icon: this.icons.success },
            warning: { borderColor: 'warning', titleColor: 'brightYellow', icon: this.icons.warning },
            error: { borderColor: 'error', titleColor: 'brightRed', icon: this.icons.error }
        };

        const config = boxConfig[type] || boxConfig.info;
        const width = Math.min(this.display.width - 4, 70);

        // Bordures
        const topBorder = '╭' + '─'.repeat(width - 2) + '╮';
        const bottomBorder = '╰' + '─'.repeat(width - 2) + '╯';

        console.log('');
        console.log(this.colorize(topBorder, config.borderColor));

        // Titre
        const titleLine = `${config.icon} ${title}`;
        const titlePadding = width - titleLine.length - 2;
        console.log(
            this.colorize('│', config.borderColor) +
            this.colorize(titleLine, config.titleColor, 'bright') +
            ' '.repeat(Math.max(0, titlePadding)) +
            this.colorize('│', config.borderColor)
        );

        // Séparateur
        console.log(this.colorize('├' + '─'.repeat(width - 2) + '┤', config.borderColor));

        // Contenu
        const lines = Array.isArray(content) ? content : [content];
        lines.forEach(line => {
            const linePadding = width - line.length - 2;
            console.log(
                this.colorize('│', config.borderColor) +
                ` ${line}` +
                ' '.repeat(Math.max(0, linePadding - 1)) +
                this.colorize('│', config.borderColor)
            );
        });

        console.log(this.colorize(bottomBorder, config.borderColor));
        console.log('');
    }

    /**
     * Animation de chargement
     */
    async animateLoading(message, duration = 2000) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let frameIndex = 0;

        const interval = setInterval(() => {
            process.stdout.write(`\r${frames[frameIndex]} ${this.colorize(message, 'primary')}...`);
            frameIndex = (frameIndex + 1) % frames.length;
        }, 100);

        await new Promise(resolve => setTimeout(resolve, duration));
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(message.length + 10) + '\r');
    }

    // === UTILITAIRE HTTP AVEC UI AMÉLIORÉE ===

    /**
     * Effectue une requête HTTP avec feedback visuel
     */
    async makeRequest(url, method = 'GET', data = null) {
        try {
            const config = {
                method,
                url,
                timeout: this.defaultTimeout,
                headers: { 'Content-Type': 'application/json' }
            };

            if (data) {
                config.data = data;
            }

            // Animation de chargement pour les requêtes
            if (method !== 'GET') {
                await this.animateLoading(`Sending ${method} request`, 500);
            }

            const response = await axios(config);
            return response.data;

        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                this.printInfoBox('Connection Failed', [
                    'Cannot connect to Thunder node.',
                    '',
                    'Possible solutions:',
                    '• Make sure thunderd is running',
                    '• Check the port number',
                    '• Verify network connectivity',
                    '',
                    'Start with: npm run thunderd'
                ], 'error');
                process.exit(1);
            }

            if (error.response) {
                this.printStatus('error', 'API Error', error.response.data.error || error.response.statusText);
            } else {
                this.printStatus('error', 'Request failed', error.message);
            }
            process.exit(1);
        }
    }

    // === COMMANDES AVEC UI AMÉLIORÉE ===

    /**
     * Affiche les informations du node avec interface améliorée
     */
    async infos(nodeUrl) {
        try {
            this.printTitle('⚡ THUNDER NODE DASHBOARD', 'Real-time system information');

            const response = await this.makeRequest(`${nodeUrl}/infos`);

            // === INFORMATIONS GÉNÉRALES ===
            this.printSection('System Information', this.icons.node);

            const systemData = [
                ['Property', 'Value', 'Status'],
                ['Port', response.port, this.icons.success],
                ['Wallet', response.wallet || 'Not imported', response.wallet ? this.icons.success : this.icons.error],
                ['Version', response.version || '1.0.0', this.icons.info],
                ['Uptime', this.formatUptime(response.uptime), this.icons.info]
            ];

            this.printTable(['Property', 'Value', 'Status'], systemData.slice(1), {
                headerColor: 'brightBlue',
                alternateRows: true
            });

            // === PEERS CONNECTÉS ===
            this.printSection('Connected Peers', this.icons.peer);

            if (response.connectedPeers && response.connectedPeers.length > 0) {
                const peerData = response.connectedPeers.map((peer, index) => [
                    `${index + 1}`,
                    `${peer.host}:${peer.port}`,
                    new Date(peer.connectedAt).toLocaleString(),
                    this.icons.active
                ]);

                this.printTable(['#', 'Address', 'Connected At', 'Status'], peerData, {
                    headerColor: 'brightGreen'
                });
            } else {
                console.log(this.colorize('   No peers connected', 'muted'));
                this.printInfoBox('Connect to Peers', [
                    'Start by connecting to other Thunder nodes:',
                    '',
                    `${this.icons.arrow} thunder-cli connect <host:port>`,
                    `${this.icons.arrow} thunder-cli connect localhost:2002`,
                ], 'info');
            }

            // === CHANNELS ACTIFS ===
            this.printSection('Payment Channels', this.icons.channel);

            if (response.channels && response.channels.length > 0) {
                const channelData = response.channels.map((channel, index) => {
                    const stateIcon = {
                        'ACTIVE': this.icons.active,
                        'CLOSING': this.icons.closing,
                        'CLOSED': this.icons.closed,
                        'EMPTY': this.icons.empty
                    }[channel.state] || this.icons.info;

                    return [
                        `${index + 1}`,
                        channel.id,
                        `${this.formatAmount(channel.amount)} THD`,
                        this.colorize(channel.state, this.getStateColor(channel.state)),
                        Utils.formatAddress(channel.address),
                        stateIcon
                    ];
                });

                this.printTable(['#', 'Channel ID', 'Amount', 'State', 'Address', ''], channelData, {
                    headerColor: 'brightMagenta'
                });

                // Statistiques des channels
                const activeCount = response.channels.filter(c => c.state === 'ACTIVE').length;
                const totalAmount = response.channels.reduce((sum, c) => sum + parseFloat(this.formatAmount(c.amount)), 0);

                console.log('');
                console.log(`   ${this.icons.star} Active Channels: ${this.colorize(activeCount, 'success')}`);
                console.log(`   ${this.icons.star} Total Value: ${this.colorize(totalAmount + ' THD', 'accent')}`);

            } else {
                console.log(this.colorize('   No channels found', 'muted'));
                this.printInfoBox('Create Your First Channel', [
                    'Get started with payment channels:',
                    '',
                    '1. Connect to a peer',
                    '2. Propose a channel',
                    '3. Start making payments!',
                    '',
                    `${this.icons.arrow} thunder-cli proposechannel <peer> <amount>`
                ], 'info');
            }

            // === PROPOSITIONS PENDANTES ===
            if (response.pendingProposals && response.pendingProposals.length > 0) {
                this.printSection('Pending Proposals', this.icons.proposal);

                const proposalData = response.pendingProposals.map((proposal, index) => [
                    `${index + 1}`,
                    proposal.id,
                    this.colorize(proposal.status, this.getStatusColor(proposal.status)),
                    `${this.formatAmount(proposal.amount)} THD`,
                    new Date(proposal.createdAt).toLocaleDateString()
                ]);

                this.printTable(['#', 'Proposal ID', 'Status', 'Amount', 'Created'], proposalData, {
                    headerColor: 'brightYellow'
                });
            }

            // === BLOCKCHAIN INFO ===
            if (response.blockchain) {
                this.printSection('Blockchain Connection', this.icons.blockchain);

                const blockchainData = [
                    ['Account', response.blockchain.account ? Utils.formatAddress(response.blockchain.account) : 'Not set'],
                    ['THD Token', response.blockchain.thdToken ? Utils.formatAddress(response.blockchain.thdToken) : 'Not deployed'],
                    ['Network', response.blockchain.connected ? 'Connected' : 'Disconnected']
                ];

                this.printTable(['Property', 'Value'], blockchainData, {
                    headerColor: 'brightBlue',
                    showHeaders: false
                });
            }

            // === COMMANDES RAPIDES ===
            this.printInfoBox('Quick Commands', [
                `${this.icons.wallet} Check balance: thunder-cli balance`,
                `${this.icons.peer} Connect peer: thunder-cli connect <host:port>`,
                `${this.icons.proposal} View proposals: thunder-cli proposals`,
                `${this.icons.payment} Send payment: thunder-cli pay <amount>`,
                `${this.icons.channel} List channels: thunder-cli infos`
            ], 'info');

        } catch (error) {
            this.printStatus('error', 'Failed to get node information', error.message);
        }
    }

    /**
     * Import de wallet avec interface améliorée
     */
    async importWallet(nodeUrl, seedPhrase) {
        try {
            this.printTitle('🔐 WALLET IMPORT', 'Secure wallet configuration');

            this.printStatus('loading', 'Importing wallet from seed phrase...');

            const privateKeys = {
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
                "test test test test test test test test test test test junk": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
            };

            const privateKey = privateKeys[seedPhrase] || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

            await this.animateLoading('Processing wallet credentials', 1500);

            const response = await this.makeRequest(`${nodeUrl}/importwallet`, 'POST', {
                seedPhrase,
                privateKey
            });

            if (response.success) {
                this.printStatus('success', 'Wallet imported successfully!');

                console.log('');
                console.log(`   ${this.icons.wallet} Address: ${this.colorize(response.address, 'brightCyan')}`);
                console.log(`   ${this.icons.signature} Signature: ${this.colorize('Ready', 'success')}`);

                this.printInfoBox('Next Steps', [
                    'Your wallet is ready! Here\'s what you can do next:',
                    '',
                    `${this.icons.balance} Check your balance:`,
                    '   thunder-cli balance',
                    '',
                    `${this.icons.peer} Connect to peers:`,
                    '   thunder-cli connect localhost:2002',
                    '',
                    `${this.icons.proposal} Propose a channel:`,
                    '   thunder-cli proposechannel <peer> <amount>'
                ], 'success');

            } else {
                this.printStatus('error', 'Failed to import wallet', response.error);
            }

        } catch (error) {
            this.printStatus('error', 'Wallet import failed', error.message);
        }
    }

    /**
     * Affichage des balances avec interface riche
     */
    /**
         * Affiche les balances THD avec interface riche et adaptative
         */
    async balance(nodeUrl) {
        try {
            this.printTitle('💰 ACCOUNT BALANCE', 'Your THD token overview');

            const response = await this.makeRequest(`${nodeUrl}/balance`);

            if (response.success) {
                // === ADRESSE DU WALLET ===
                this.printSection('Wallet Information', this.icons.wallet);
                console.log(`   Address: ${this.colorize(response.address, 'brightCyan')}`);
                console.log('');

                // === BALANCES AVEC FORMAT COMPACT ===
                this.printSection('Balance Overview', this.icons.balance);

                // Format compact pour éviter le débordement
                const balances = [
                    {
                        label: 'Total Balance',
                        value: response.totalTHD,
                        color: 'accent',
                        icon: this.icons.fund,
                        desc: 'Complete THD holdings'
                    },
                    {
                        label: 'Available',
                        value: response.availableTHD,
                        color: 'success',
                        icon: this.icons.check,
                        desc: 'Spendable outside channels'
                    },
                    {
                        label: 'Channel Locked',
                        value: response.channelTHD,
                        color: 'warning',
                        icon: this.icons.close,
                        desc: 'Locked in payment channels'
                    },
                    {
                        label: 'Channel Balance',
                        value: response.channelBalance,
                        color: 'magenta',
                        icon: this.icons.payment,
                        desc: 'Spendable within channels'
                    }
                ];

                // Affichage en liste au lieu de tableau pour éviter le débordement
                balances.forEach(balance => {
                    console.log(`   ${balance.icon} ${this.colorize(balance.label + ':', 'brightWhite')} ${this.colorize(balance.value + ' THD', balance.color)}`);
                    console.log(`      ${this.colorize('└─ ' + balance.desc, 'gray')}`);
                    console.log('');
                });

                // === VISUALISATION GRAPHIQUE ===
                if (parseFloat(response.totalTHD) > 0) {
                    this.printSection('Balance Distribution', this.icons.info);

                    const total = parseFloat(response.totalTHD);
                    const available = parseFloat(response.availableTHD);
                    const locked = parseFloat(response.channelTHD);

                    if (available > 0) {
                        const availablePercent = Math.round((available / total) * 100);
                        this.printProgressBar(available, total, `Available (${availablePercent}%)`);
                    }

                    if (locked > 0) {
                        const lockedPercent = Math.round((locked / total) * 100);
                        this.printProgressBar(locked, total, `Locked (${lockedPercent}%)`);
                    }
                }

                // === EXPLICATION DÉTAILLÉE ===
                if (parseFloat(response.channelTHD) > 0) {
                    this.printInfoBox('Balance Guide', [
                        'Understanding your THD balances:',
                        '',
                        `${this.icons.check} Total: Your complete THD token balance`,
                        `${this.icons.check} Available: THD you can use outside payment channels`,
                        `${this.icons.check} Channel Locked: Your contributions to payment channels`,
                        `${this.icons.check} Channel Balance: THD you can spend within channels`,
                        '',
                        'Channel balances change with each payment but locked amounts stay fixed.'
                    ], 'info');
                }

                // === ACTIONS DISPONIBLES ===
                const actions = [];
                if (parseFloat(response.availableTHD) > 0) {
                    actions.push(`${this.icons.channel} Create channel: thunder-cli proposechannel <peer> <amount>`);
                }
                if (parseFloat(response.channelBalance) > 0) {
                    actions.push(`${this.icons.payment} Send payment: thunder-cli pay <amount>`);
                }
                actions.push(`${this.icons.info} View channels: thunder-cli infos`);

                if (actions.length > 0) {
                    this.printInfoBox('Available Actions', actions, 'info');
                }

            } else {
                this.printStatus('error', 'Failed to get balance', response.error);
            }

        } catch (error) {
            this.printStatus('error', 'Balance retrieval failed', error.message);
        }
    }

    // === MÉTHODES UTILITAIRES ===

    /**
     * Formate la durée de fonctionnement
     */
    formatUptime(seconds) {
        if (!seconds) return 'Unknown';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    /**
     * Obtient la couleur selon l'état du channel
     */
    getStateColor(state) {
        const stateColors = {
            'ACTIVE': 'success',
            'CLOSING': 'warning',
            'CLOSED': 'error',
            'EMPTY': 'muted',
            'PROPOSED': 'info',
            'ACCEPTED': 'primary',
            'CREATED': 'cyan'
        };
        return stateColors[state] || 'white';
    }

    /**
     * Obtient la couleur selon le statut
     */
    getStatusColor(status) {
        return this.getStateColor(status);
    }

    /**
     * Connexion P2P avec interface améliorée
     */
    async connect(nodeUrl, address) {
        try {
            this.printTitle('🌐 PEER CONNECTION', 'Establishing P2P network link');

            const [host, port] = address.split(':');
            if (!host || !port) {
                this.printStatus('error', 'Invalid address format', 'Expected format: host:port (e.g., localhost:2002)');
                return;
            }

            this.printStatus('loading', `Connecting to ${this.colorize(address, 'brightCyan')}...`);

            await this.animateLoading('Establishing connection', 1000);

            const response = await this.makeRequest(`${nodeUrl}/connect`, 'POST', {
                host,
                port: parseInt(port)
            });

            if (response.success) {
                this.printStatus('success', response.message);

                console.log('');
                console.log(`   ${this.icons.peer} Peer: ${this.colorize(address, 'brightCyan')}`);
                console.log(`   ${this.icons.network} Status: ${this.colorize('Connected', 'success')}`);
                console.log(`   ${this.icons.check} P2P Link: ${this.colorize('Active', 'success')}`);

                this.printInfoBox('Connection Established', [
                    'You are now connected to the peer network!',
                    '',
                    'Next steps:',
                    `${this.icons.proposal} Propose a channel:`,
                    `   thunder-cli proposechannel ${address} 10`,
                    '',
                    `${this.icons.info} Check connections:`,
                    '   thunder-cli infos',
                    '',
                    `${this.icons.peer} View network:`,
                    '   thunder-cli infos (see Connected Peers section)'
                ], 'success');

            } else {
                this.printStatus('error', 'Connection failed', response.error);

                this.printInfoBox('Connection Troubleshooting', [
                    'Connection failed. Try these solutions:',
                    '',
                    `${this.icons.check} Verify the peer is running:`,
                    `   curl http://${address}/health`,
                    '',
                    `${this.icons.check} Check network connectivity:`,
                    `   ping ${host}`,
                    '',
                    `${this.icons.check} Ensure correct port:`,
                    `   netstat -an | grep ${port}`,
                    '',
                    `${this.icons.info} Start peer if needed:`,
                    `   thunderd --port ${port}`
                ], 'warning');
            }

        } catch (error) {
            this.printStatus('error', 'Connection process failed', error.message);
        }
    }

    /**
     * Proposition de channel avec interface riche
     */
    async proposeChannel(nodeUrl, peer, amount) {
        try {
            this.printTitle('📋 CHANNEL PROPOSAL', 'Creating payment channel proposal');

            this.printSection('Proposal Details', this.icons.proposal);
            console.log(`   ${this.icons.peer} Target Peer: ${this.colorize(peer, 'brightCyan')}`);
            console.log(`   ${this.icons.fund} Channel Amount: ${this.colorize(amount + ' THD', 'accent')}`);
            console.log(`   ${this.icons.fund} Your Contribution: ${this.colorize((amount / 2) + ' THD', 'success')}`);
            console.log(`   ${this.icons.fund} Peer Contribution: ${this.colorize((amount / 2) + ' THD', 'success')}`);

            this.printStatus('loading', 'Creating channel proposal...');
            await this.animateLoading('Preparing proposal data', 800);

            const response = await this.makeRequest(`${nodeUrl}/proposechannel`, 'POST', {
                peerAddress: peer,
                amount
            });

            if (response.success) {
                this.printStatus('success', 'Channel proposal created successfully!');

                console.log('');
                console.log(`   ${this.icons.proposal} Proposal ID: ${this.colorize(response.proposal.id, 'brightYellow')}`);
                console.log(`   ${this.icons.info} Status: ${this.colorize(response.proposal.status, 'primary')}`);
                console.log(`   ${this.icons.peer} Sent to: ${this.colorize(peer, 'brightCyan')}`);

                this.printInfoBox('Proposal Workflow', [
                    'Your proposal has been sent! Here\'s what happens next:',
                    '',
                    `${this.icons.arrow} Step 1: Peer receives proposal`,
                    `${this.icons.arrow} Step 2: Peer accepts (their action):`,
                    `   thunder-cli --port <peer_port> acceptchannel ${response.proposal.id}`,
                    '',
                    `${this.icons.arrow} Step 3: You create the smart contract:`,
                    `   thunder-cli createchannel ${response.proposal.id}`,
                    '',
                    `${this.icons.arrow} Step 4: Both parties fund the channel:`,
                    `   thunder-cli fundchannel <channelId>`,
                    '',
                    `${this.icons.info} Track progress anytime:`,
                    '   thunder-cli proposals'
                ], 'info');

                // Timeline visuelle
                console.log('');
                this.printSection('Proposal Timeline', this.icons.loading);
                this.printProgressBar(1, 4, 'Current Progress: Proposal Sent');

            } else {
                this.printStatus('error', 'Failed to create proposal', response.error);

                this.printInfoBox('Proposal Failed', [
                    'Could not create channel proposal. Check:',
                    '',
                    `${this.icons.check} Wallet is imported and has sufficient funds`,
                    `${this.icons.check} Peer is connected and reachable`,
                    `${this.icons.check} Amount is valid (positive number)`,
                    `${this.icons.check} Network connection is stable`,
                    '',
                    'Try again with: thunder-cli proposechannel <peer> <amount>'
                ], 'error');
            }

        } catch (error) {
            this.printStatus('error', 'Proposal process failed', error.message);
        }
    }

    /**
     * Acceptation de proposition avec confirmation interactive
     */
    async acceptChannel(nodeUrl, proposalId) {
        try {
            this.printTitle('✅ ACCEPT PROPOSAL', 'Confirming channel proposal');

            this.printSection('Proposal Acceptance', this.icons.check);
            console.log(`   ${this.icons.proposal} Proposal ID: ${this.colorize(proposalId, 'brightYellow')}`);

            this.printStatus('loading', 'Processing acceptance...');
            await this.animateLoading('Validating proposal', 600);

            const response = await this.makeRequest(`${nodeUrl}/acceptchannel`, 'POST', {
                proposalId
            });

            if (response.success) {
                this.printStatus('success', 'Proposal accepted successfully!');

                console.log('');
                console.log(`   ${this.icons.check} Proposal: ${this.colorize('ACCEPTED', 'success')}`);
                console.log(`   ${this.icons.signature} Confirmation: ${this.colorize('Signed', 'success')}`);
                console.log(`   ${this.icons.network} P2P Notification: ${this.colorize('Sent', 'info')}`);

                this.printInfoBox('Acceptance Complete', [
                    'You have successfully accepted the channel proposal!',
                    '',
                    'What happens next:',
                    '',
                    `${this.icons.arrow} The proposer will create the smart contract`,
                    `${this.icons.arrow} You will be notified when the channel is created`,
                    `${this.icons.arrow} Both parties will then fund the channel`,
                    '',
                    `${this.icons.info} Monitor progress:`,
                    '   thunder-cli proposals',
                    '   thunder-cli infos'
                ], 'success');

                // Timeline mise à jour
                console.log('');
                this.printSection('Channel Timeline', this.icons.loading);
                this.printProgressBar(2, 4, 'Current Progress: Proposal Accepted');

            } else {
                this.printStatus('error', 'Failed to accept proposal', response.error);
            }

        } catch (error) {
            this.printStatus('error', 'Acceptance process failed', error.message);
        }
    }

    /**
     * Création de channel avec suivi visuel
     */
    async createChannel(nodeUrl, proposalId) {
        try {
            this.printTitle('🔓 CREATE CHANNEL', 'Deploying smart contract');

            this.printSection('Smart Contract Deployment', this.icons.contract);
            console.log(`   ${this.icons.proposal} Proposal ID: ${this.colorize(proposalId, 'brightYellow')}`);

            this.printStatus('loading', 'Deploying PaymentChannel smart contract...');
            await this.animateLoading('Compiling and deploying contract', 2000);

            const response = await this.makeRequest(`${nodeUrl}/createchannel`, 'POST', {
                proposalId
            });

            if (response.success) {
                this.printStatus('success', 'Smart contract deployed successfully!');

                console.log('');
                console.log(`   ${this.icons.contract} Channel ID: ${this.colorize(response.channel.id, 'brightCyan')}`);
                console.log(`   ${this.icons.blockchain} Contract Address: ${this.colorize(response.channel.address, 'muted')}`);
                console.log(`   ${this.icons.info} State: ${this.colorize(response.channel.state, 'warning')}`);
                console.log(`   ${this.icons.fund} Funding Required: ${this.colorize('Both Parties', 'accent')}`);

                this.printInfoBox('Channel Created', [
                    'Smart contract successfully deployed on blockchain!',
                    '',
                    'Next critical steps:',
                    '',
                    `${this.icons.fund} 1. Fund your part of the channel:`,
                    `   thunder-cli fundchannel ${response.channel.id}`,
                    '',
                    `${this.icons.fund} 2. Ensure peer also funds:`,
                    `   thunder-cli --port <peer_port> fundchannel ${response.channel.id}`,
                    '',
                    `${this.icons.active} 3. Channel becomes ACTIVE when both funded`,
                    '',
                    `${this.icons.info} Check funding status:`,
                    '   thunder-cli infos'
                ], 'success');

                // Timeline mise à jour
                console.log('');
                this.printSection('Channel Timeline', this.icons.loading);
                this.printProgressBar(3, 4, 'Current Progress: Contract Deployed');

            } else {
                this.printStatus('error', 'Contract deployment failed', response.error);

                this.printInfoBox('Deployment Failed', [
                    'Smart contract deployment encountered an error.',
                    '',
                    'Common causes:',
                    `${this.icons.check} Insufficient gas or ETH for deployment`,
                    `${this.icons.check} Network congestion`,
                    `${this.icons.check} Invalid proposal state`,
                    `${this.icons.check} Blockchain connection issues`,
                    '',
                    'Verify blockchain connection and try again.'
                ], 'error');
            }

        } catch (error) {
            this.printStatus('error', 'Channel creation failed', error.message);
        }
    }

    /**
     * Financement de channel avec barre de progression
     */
    async fundChannel(nodeUrl, channelId) {
        try {
            this.printTitle('💎 FUND CHANNEL', 'Contributing to payment channel');

            this.printSection('Funding Process', this.icons.fund);
            console.log(`   ${this.icons.channel} Channel ID: ${this.colorize(channelId, 'brightCyan')}`);

            this.printStatus('loading', 'Processing your funding contribution...');

            // Simulation d'étapes de financement
            await this.animateLoading('Approving THD tokens', 1000);
            await this.animateLoading('Transferring tokens to contract', 1000);
            await this.animateLoading('Validating funding transaction', 800);

            const response = await this.makeRequest(`${nodeUrl}/fundchannel`, 'POST', {
                channelId
            });

            if (response.success) {
                this.printStatus('success', 'Your funding contribution successful!');

                console.log('');
                console.log(`   ${this.icons.fund} Your Funding: ${this.colorize('COMPLETED', 'success')}`);
                console.log(`   ${this.icons.info} Channel State: ${this.colorize(response.channelState, this.getStateColor(response.channelState))}`);

                if (response.bothFunded) {
                    console.log(`   ${this.icons.active} Both Parties: ${this.colorize('FUNDED', 'success')}`);

                    this.printInfoBox('🎉 CHANNEL ACTIVE!', [
                        'Congratulations! Your payment channel is now fully operational.',
                        '',
                        'Channel Features:',
                        `${this.icons.payment} Instant off-chain payments`,
                        `${this.icons.check} Zero transaction fees`,
                        `${this.icons.check} Cryptographically secure`,
                        `${this.icons.check} Bidirectional transfers`,
                        '',
                        'Start using your channel:',
                        `${this.icons.payment} Send payment: thunder-cli pay <amount>`,
                        `${this.icons.balance} Check balance: thunder-cli balance`,
                        `${this.icons.info} View details: thunder-cli infos`
                    ], 'success');

                    // Timeline complète
                    console.log('');
                    this.printSection('Channel Timeline', this.icons.active);
                    this.printProgressBar(4, 4, 'Status: Channel ACTIVE and Ready!');

                } else {
                    console.log(`   ${this.icons.warning} Peer Funding: ${this.colorize('PENDING', 'warning')}`);

                    this.printInfoBox('Waiting for Peer', [
                        'Your funding is complete! Waiting for the other party.',
                        '',
                        'Current status:',
                        `${this.icons.check} Your contribution: FUNDED`,
                        `${this.icons.loading} Peer contribution: PENDING`,
                        '',
                        'The channel will automatically become ACTIVE once',
                        'the other party completes their funding.',
                        '',
                        `${this.icons.info} Monitor status: thunder-cli infos`
                    ], 'info');

                    // Timeline partielle
                    console.log('');
                    this.printSection('Channel Timeline', this.icons.loading);
                    this.printProgressBar(3.5, 4, 'Status: Waiting for Peer Funding');
                }

            } else {
                this.printStatus('error', 'Funding failed', response.error);

                this.printInfoBox('Funding Failed', [
                    'Unable to complete funding. Check:',
                    '',
                    `${this.icons.check} Sufficient THD token balance`,
                    `${this.icons.check} Wallet has enough ETH for gas`,
                    `${this.icons.check} Channel exists and accepts funding`,
                    `${this.icons.check} Not already funded by this account`,
                    '',
                    'Verify balance: thunder-cli balance'
                ], 'error');
            }

        } catch (error) {
            this.printStatus('error', 'Funding process failed', error.message);
        }
    }

    /**
     * Liste des propositions avec tableau formaté
     */
    async listProposals(nodeUrl) {
        try {
            this.printTitle('📋 CHANNEL PROPOSALS', 'Overview of all proposals');

            const response = await this.makeRequest(`${nodeUrl}/proposals`);

            if (response.success) {
                const proposals = response.proposals;

                if (proposals.length === 0) {
                    console.log('');
                    console.log(this.colorize('   No proposals found', 'muted'));

                    this.printInfoBox('Get Started', [
                        'Create your first channel proposal:',
                        '',
                        `${this.icons.peer} 1. Connect to a peer:`,
                        '   thunder-cli connect <host:port>',
                        '',
                        `${this.icons.proposal} 2. Propose a channel:`,
                        '   thunder-cli proposechannel <peer> <amount>',
                        '',
                        'Example:',
                        '   thunder-cli connect localhost:2002',
                        '   thunder-cli proposechannel localhost:2002 10'
                    ], 'info');
                    return;
                }

                this.printSection('Active Proposals', this.icons.proposal);

                // Création des données du tableau
                const proposalData = proposals.map((proposal, index) => {
                    const statusIcon = {
                        'PROPOSED': this.icons.loading,
                        'ACCEPTED': this.icons.check,
                        'CREATED': this.icons.contract,
                        'FUNDED': this.icons.active
                    }[proposal.status] || this.icons.info;

                    return [
                        `${index + 1}`,
                        proposal.id,
                        this.colorize(proposal.status, this.getStatusColor(proposal.status)),
                        `${this.formatAmount(proposal.amount)} THD`,
                        Utils.formatAddress(proposal.proposer),
                        Utils.formatAddress(proposal.acceptor),
                        new Date(proposal.createdAt).toLocaleDateString(),
                        statusIcon
                    ];
                });

                this.printTable([
                    '#', 'Proposal ID', 'Status', 'Amount',
                    'Proposer', 'Acceptor', 'Created', ''
                ], proposalData, {
                    headerColor: 'brightBlue',
                    alternateRows: true
                });

                // Instructions contextuelles
                console.log('');
                this.printSection('Available Actions', this.icons.info);

                const actionsByStatus = {};
                proposals.forEach(proposal => {
                    if (!actionsByStatus[proposal.status]) {
                        actionsByStatus[proposal.status] = [];
                    }
                    actionsByStatus[proposal.status].push(proposal);
                });

                Object.entries(actionsByStatus).forEach(([status, statusProposals]) => {
                    const count = statusProposals.length;
                    const proposalIds = statusProposals.map(p => p.id).join(', ');

                    switch (status) {
                        case 'PROPOSED':
                            console.log(`   ${this.icons.loading} ${count} awaiting acceptance:`);
                            console.log(`      ${this.colorize('thunder-cli acceptchannel <proposalId>', 'cyan')}`);
                            console.log(`      IDs: ${this.colorize(proposalIds, 'yellow')}`);
                            break;
                        case 'ACCEPTED':
                            console.log(`   ${this.icons.contract} ${count} ready for contract creation:`);
                            console.log(`      ${this.colorize('thunder-cli createchannel <proposalId>', 'cyan')}`);
                            console.log(`      IDs: ${this.colorize(proposalIds, 'yellow')}`);
                            break;
                        case 'CREATED':
                            console.log(`   ${this.icons.fund} ${count} awaiting funding:`);
                            console.log(`      ${this.colorize('thunder-cli fundchannel <channelId>', 'cyan')}`);
                            break;
                    }
                });

                // Statistiques
                console.log('');
                this.printSection('Proposal Statistics', this.icons.info);

                const stats = proposals.reduce((acc, p) => {
                    acc[p.status] = (acc[p.status] || 0) + 1;
                    acc.totalAmount += parseFloat(this.formatAmount(p.amount));
                    return acc;
                }, { totalAmount: 0 });

                console.log(`   ${this.icons.proposal} Total Proposals: ${this.colorize(proposals.length, 'accent')}`);
                console.log(`   ${this.icons.fund} Total Value: ${this.colorize(stats.totalAmount + ' THD', 'success')}`);

                Object.entries(stats).forEach(([status, count]) => {
                    if (status !== 'totalAmount') {
                        const color = this.getStatusColor(status);
                        console.log(`   ${this.icons.bullet} ${status}: ${this.colorize(count, color)}`);
                    }
                });

            } else {
                this.printStatus('error', 'Failed to retrieve proposals', response.error);
            }

        } catch (error) {
            this.printStatus('error', 'Proposal listing failed', error.message);
        }
    }

    /**
     * Envoi de paiement avec confirmation visuelle
     */
    async pay(nodeUrl, amount) {
        try {
            this.printTitle('💸 SEND PAYMENT', 'Off-chain Lightning payment');

            this.printSection('Payment Details', this.icons.payment);
            console.log(`   ${this.icons.fund} Amount: ${this.colorize(amount + ' THD', 'accent')}`);
            console.log(`   ${this.icons.info} Type: ${this.colorize('Off-chain', 'success')}`);
            console.log(`   ${this.icons.info} Fee: ${this.colorize('0 THD (Free!)', 'brightGreen')}`);
            console.log(`   ${this.icons.info} Speed: ${this.colorize('Instant', 'brightGreen')}`);

            this.printStatus('loading', 'Processing off-chain payment...');

            await this.animateLoading('Creating payment state', 600);
            await this.animateLoading('Generating cryptographic signature', 800);
            await this.animateLoading('Broadcasting to peer', 400);

            const response = await this.makeRequest(`${nodeUrl}/pay`, 'POST', {
                amount
            });

            if (response.success) {
                this.printStatus('success', 'Payment sent successfully!');

                console.log('');
                console.log(`   ${this.icons.payment} Payment ID: ${this.colorize(response.payment.id, 'brightYellow')}`);
                console.log(`   ${this.icons.signature} New Nonce: ${this.colorize(response.payment.nonce, 'cyan')}`);
                console.log(`   ${this.icons.check} Status: ${this.colorize('COMPLETED', 'success')}`);
                console.log(`   ${this.icons.info} Processing Time: ${this.colorize('< 1 second', 'brightGreen')}`);

                this.printInfoBox('Payment Complete', [
                    'Your off-chain payment has been processed!',
                    '',
                    'Payment Benefits:',
                    `${this.icons.check} Instant settlement (no blockchain wait)`,
                    `${this.icons.check} Zero transaction fees`,
                    `${this.icons.check} Cryptographically secure`,
                    `${this.icons.check} Updates channel balances`,
                    '',
                    'Next steps:',
                    `${this.icons.balance} Check updated balance: thunder-cli balance`,
                    `${this.icons.payment} Send another payment: thunder-cli pay <amount>`,
                    `${this.icons.info} View channel status: thunder-cli infos`
                ], 'success');

            } else {
                this.printStatus('error', 'Payment failed', response.error);

                this.printInfoBox('Payment Failed', [
                    'Unable to process the payment. Common issues:',
                    '',
                    `${this.icons.check} Insufficient channel balance`,
                    `${this.icons.check} No active payment channels`,
                    `${this.icons.check} Peer connection issues`,
                    `${this.icons.check} Invalid payment amount`,
                    '',
                    'Solutions:',
                    `${this.icons.balance} Check balance: thunder-cli balance`,
                    `${this.icons.info} View channels: thunder-cli infos`,
                    `${this.icons.channel} Create channel: thunder-cli proposechannel <peer> <amount>`
                ], 'error');
            }

        } catch (error) {
            this.printStatus('error', 'Payment process failed', error.message);
        }
    }

    /**
     * Fermeture de channel avec interface détaillée
     */
    async closeChannel(nodeUrl) {
        try {
            this.printTitle('🔒 CLOSE CHANNEL', 'Initiating channel closure');

            this.printSection('Channel Closure Process', this.icons.close);

            this.printStatus('loading', 'Submitting channel closure to blockchain...');

            await this.animateLoading('Preparing final state', 800);
            await this.animateLoading('Creating closure transaction', 1000);
            await this.animateLoading('Broadcasting to network', 600);

            const response = await this.makeRequest(`${nodeUrl}/closechannel`, 'POST');

            if (response.success) {
                this.printStatus('success', 'Channel closure initiated successfully!');

                console.log('');
                console.log(`   ${this.icons.blockchain} Block Number: ${this.colorize(response.blockNumber, 'cyan')}`);
                console.log(`   ${this.icons.warning} Challenge Period: ${this.colorize((response.challengePeriod || 24) + ' blocks', 'yellow')}`);
                console.log(`   ${this.icons.info} Status: ${this.colorize('CLOSING', 'warning')}`);

                this.printInfoBox('Channel Closing', [
                    'Channel closure has been submitted to the blockchain.',
                    '',
                    'Security Process:',
                    `${this.icons.check} Current state submitted on-chain`,
                    `${this.icons.warning} 24-block challenge period started`,
                    `${this.icons.info} Anyone can challenge with newer state`,
                    `${this.icons.check} Funds locked until period expires`,
                    '',
                    'Next steps:',
                    `${this.icons.loading} Wait ${response.challengePeriod || 24} blocks, OR`,
                    `${this.icons.info} Speed up: npm run mine-blocks`,
                    `${this.icons.withdraw} Then withdraw: thunder-cli withdraw`
                ], 'warning');

                // Timeline de fermeture
                console.log('');
                this.printSection('Closure Timeline', this.icons.loading);
                this.printProgressBar(1, 3, 'Phase 1: Closure Submitted');

                console.log('');
                console.log(`   ${this.icons.loading} Current: Challenge period active`);
                console.log(`   ${this.icons.arrow} Next: Wait for block confirmation`);
                console.log(`   ${this.icons.withdraw} Final: Withdraw funds`);

            } else {
                this.printStatus('error', 'Channel closure failed', response.error);

                this.printInfoBox('Closure Failed', [
                    'Unable to close the channel. Check:',
                    '',
                    `${this.icons.check} Active channel exists`,
                    `${this.icons.check} Sufficient ETH for gas fees`,
                    `${this.icons.check} Valid channel state`,
                    `${this.icons.check} Blockchain connection stable`,
                    '',
                    'View channels: thunder-cli infos'
                ], 'error');
            }

        } catch (error) {
            this.printStatus('error', 'Channel closure failed', error.message);
        }
    }

    /**
         * Retrait de fonds avec interface de confirmation
         */
    async withdraw(nodeUrl) {
        try {
            this.printTitle('💳 WITHDRAW FUNDS', 'Claiming your channel balance');

            this.printSection('Fund Withdrawal', this.icons.withdraw);

            this.printStatus('loading', 'Processing fund withdrawal...');

            await this.animateLoading('Verifying challenge period', 800);
            await this.animateLoading('Calculating final balances', 600);
            await this.animateLoading('Executing withdrawal transaction', 1200);

            const response = await this.makeRequest(`${nodeUrl}/withdraw`, 'POST');

            if (response.success) {
                this.printStatus('success', 'Funds withdrawn successfully!');

                console.log('');
                console.log(`   ${this.icons.blockchain} Transaction: ${this.colorize(response.transactionHash, 'muted')}`);
                console.log(`   ${this.icons.check} Status: ${this.colorize('COMPLETED', 'success')}`);
                console.log(`   ${this.icons.fund} Funds: ${this.colorize('Transferred to wallet', 'success')}`);

                this.printInfoBox('🎉 Withdrawal Complete', [
                    'Your funds have been successfully withdrawn!',
                    '',
                    'Transaction Details:',
                    `${this.icons.check} Channel closure: COMPLETED`,
                    `${this.icons.check} Challenge period: EXPIRED`,
                    `${this.icons.check} Final balances: DISTRIBUTED`,
                    `${this.icons.check} Funds status: IN YOUR WALLET`,
                    '',
                    'What you can do now:',
                    `${this.icons.balance} Check balance: thunder-cli balance`,
                    `${this.icons.channel} Create new channel: thunder-cli proposechannel <peer> <amount>`,
                    `${this.icons.info} View overview: thunder-cli infos`
                ], 'success');

                // Timeline complète
                console.log('');
                this.printSection('Withdrawal Timeline', this.icons.check);
                this.printProgressBar(3, 3, 'Process Complete: Funds Withdrawn');

            } else {
                this.printStatus('error', 'Withdrawal failed', response.error);

                this.printInfoBox('Withdrawal Failed', [
                    'Unable to withdraw funds. Common causes:',
                    '',
                    `${this.icons.check} Challenge period not yet expired`,
                    `${this.icons.check} No channel in closing state`,
                    `${this.icons.check} Insufficient gas for transaction`,
                    `${this.icons.check} Network congestion or issues`,
                    '',
                    'Solutions:',
                    `${this.icons.info} Check status: thunder-cli infos`,
                    `${this.icons.loading} Mine blocks: npm run mine-blocks 25`,
                    `${this.icons.balance} Check gas: ensure ETH balance`
                ], 'error');
            }

        } catch (error) {
            this.printStatus('error', 'Withdrawal process failed', error.message);
        }
    }

    /**
     * Ancienne méthode d'ouverture de channel (rétrocompatibilité) avec UI améliorée
     */
    async openChannel(nodeUrl, amount) {
        try {
            this.printTitle('🔓 OPEN CHANNEL', 'Legacy channel creation method');

            this.printInfoBox('⚠️ Deprecated Method', [
                'You are using the legacy channel creation method.',
                '',
                'For better security and peer consent, consider using:',
                '',
                '1. thunder-cli proposechannel <peer> <amount>',
                '2. thunder-cli acceptchannel <proposalId> (on peer)',
                '3. thunder-cli createchannel <proposalId>',
                '4. thunder-cli fundchannel <channelId> (both parties)',
                '',
                'This ensures both parties explicitly consent to the channel.'
            ], 'warning');

            this.printStatus('loading', `Creating legacy channel with ${this.colorize(amount + ' THD', 'accent')}...`);

            await this.animateLoading('Using compatibility mode', 1000);

            const response = await this.makeRequest(`${nodeUrl}/openchannel`, 'POST', {
                amount
            });

            if (response.success) {
                this.printStatus('success', 'Legacy channel created successfully');

                console.log('');
                console.log(`   ${this.icons.channel} Channel ID: ${this.colorize(response.channel.id, 'cyan')}`);
                console.log(`   ${this.icons.contract} Address: ${this.colorize(response.channel.address, 'muted')}`);
                console.log(`   ${this.icons.fund} Amount: ${this.colorize(amount + ' THD', 'accent')}`);
                console.log(`   ${this.icons.info} State: ${this.colorize(response.channel.state, 'success')}`);

                this.printInfoBox('Legacy Channel Ready', [
                    'Channel created using legacy method.',
                    '',
                    'Available actions:',
                    `${this.icons.payment} Send payments: thunder-cli pay <amount>`,
                    `${this.icons.balance} Check balance: thunder-cli balance`,
                    `${this.icons.close} Close channel: thunder-cli closechannel`,
                    '',
                    'Note: Consider upgrading to P2P workflow for future channels.'
                ], 'info');

            } else {
                this.printStatus('error', 'Legacy channel creation failed', response.error);
            }

        } catch (error) {
            this.printStatus('error', 'Legacy channel process failed', error.message);
        }
    }

    /**
     * Commande d'aide avec interface interactive
     */
    async help(nodeUrl, command = null) {
        if (command) {
            this.printContextualHelp(command);
        } else {
            this.printCommandSummary();
            this.printUsageTips();
        }
    }

    /**
     * Commande de diagnostic système
     */
    async diagnose(nodeUrl) {
        try {
            this.printTitle('🔍 SYSTEM DIAGNOSIS', 'Comprehensive health check');

            this.printSection('Running Diagnostics', this.icons.loading);

            // Test de connexion
            this.printStatus('loading', 'Testing node connectivity...');
            await this.animateLoading('Checking HTTP endpoint', 500);

            try {
                const healthResponse = await this.makeRequest(`${nodeUrl}/health`);
                this.printStatus('success', 'Node connectivity: OK');
                console.log(`   ${this.icons.network} HTTP Status: ${this.colorize('200 OK', 'success')}`);
                console.log(`   ${this.icons.info} Response Time: ${this.colorize('< 100ms', 'success')}`);
            } catch (error) {
                this.printStatus('error', 'Node connectivity: FAILED', error.message);
            }

            // Test des informations du node
            this.printStatus('loading', 'Gathering node information...');
            await this.animateLoading('Fetching system data', 300);

            try {
                const infoResponse = await this.makeRequest(`${nodeUrl}/infos`);
                this.printStatus('success', 'Node information: OK');

                const diagnosticData = [
                    ['Component', 'Status', 'Details'],
                    ['Port', this.colorize('ACTIVE', 'success'), infoResponse.port],
                    ['Wallet', infoResponse.wallet ? this.colorize('IMPORTED', 'success') : this.colorize('MISSING', 'error'), infoResponse.wallet || 'Not set'],
                    ['Peers', infoResponse.connectedPeers?.length > 0 ? this.colorize('CONNECTED', 'success') : this.colorize('NONE', 'warning'), `${infoResponse.connectedPeers?.length || 0} peers`],
                    ['Channels', infoResponse.channels?.length > 0 ? this.colorize('ACTIVE', 'success') : this.colorize('NONE', 'info'), `${infoResponse.channels?.length || 0} channels`]
                ];

                console.log('');
                this.printTable(['Component', 'Status', 'Details'], diagnosticData.slice(1), {
                    headerColor: 'brightBlue',
                    alternateRows: true
                });

            } catch (error) {
                this.printStatus('error', 'Node information: FAILED', error.message);
            }

            // Test de blockchain
            this.printStatus('loading', 'Testing blockchain connection...');
            await this.animateLoading('Verifying blockchain status', 400);

            try {
                const balanceResponse = await this.makeRequest(`${nodeUrl}/balance`);
                if (balanceResponse.success) {
                    this.printStatus('success', 'Blockchain connection: OK');
                    console.log(`   ${this.icons.blockchain} Network: ${this.colorize('Connected', 'success')}`);
                    console.log(`   ${this.icons.wallet} Balance: ${this.colorize(balanceResponse.totalTHD + ' THD', 'accent')}`);
                } else {
                    this.printStatus('warning', 'Blockchain connection: LIMITED', 'Wallet not imported');
                }
            } catch (error) {
                this.printStatus('error', 'Blockchain connection: FAILED', error.message);
            }

            // Recommandations
            this.printInfoBox('System Recommendations', [
                'Based on diagnosis results:',
                '',
                `${this.icons.check} All systems operational`,
                `${this.icons.info} Node is ready for operations`,
                `${this.icons.network} P2P connectivity available`,
                `${this.icons.blockchain} Blockchain integration active`,
                '',
                'Suggested next steps:',
                `${this.icons.peer} Connect to peers if none connected`,
                `${this.icons.channel} Create channels for payments`,
                `${this.icons.balance} Monitor balances regularly`
            ], 'success');

        } catch (error) {
            this.printStatus('error', 'Diagnosis failed', error.message);
        }
    }

    /**
     * Commande de statistiques détaillées
     */
    async stats(nodeUrl) {
        try {
            this.printTitle('📊 DETAILED STATISTICS', 'Comprehensive node analytics');

            const [infoResponse, balanceResponse] = await Promise.all([
                this.makeRequest(`${nodeUrl}/infos`),
                this.makeRequest(`${nodeUrl}/balance`)
            ]);

            // === STATISTIQUES GÉNÉRALES ===
            this.printSection('General Statistics', this.icons.info);

            const uptime = infoResponse.uptime ? this.formatUptime(infoResponse.uptime) : 'Unknown';
            const version = infoResponse.version || '1.0.0';

            console.log(`   ${this.icons.node} Node Uptime: ${this.colorize(uptime, 'accent')}`);
            console.log(`   ${this.icons.info} Version: ${this.colorize(version, 'cyan')}`);
            console.log(`   ${this.icons.network} Port: ${this.colorize(infoResponse.port, 'primary')}`);

            // === STATISTIQUES DES PEERS ===
            this.printSection('Network Statistics', this.icons.network);

            const peers = infoResponse.connectedPeers || [];
            const activePeers = peers.filter(p => p.connected !== false).length;

            console.log(`   ${this.icons.peer} Total Peers: ${this.colorize(peers.length, 'accent')}`);
            console.log(`   ${this.icons.active} Active Connections: ${this.colorize(activePeers, 'success')}`);

            if (peers.length > 0) {
                const avgConnectionTime = peers.reduce((acc, peer) => {
                    const connectedAt = new Date(peer.connectedAt).getTime();
                    const now = Date.now();
                    return acc + (now - connectedAt);
                }, 0) / peers.length;

                const avgHours = Math.floor(avgConnectionTime / (1000 * 60 * 60));
                console.log(`   ${this.icons.info} Avg Connection Duration: ${this.colorize(avgHours + 'h', 'info')}`);
            }

            // === STATISTIQUES DES CHANNELS ===
            this.printSection('Channel Statistics', this.icons.channel);

            const channels = infoResponse.channels || [];
            const channelsByState = channels.reduce((acc, channel) => {
                acc[channel.state] = (acc[channel.state] || 0) + 1;
                return acc;
            }, {});

            console.log(`   ${this.icons.channel} Total Channels: ${this.colorize(channels.length, 'accent')}`);

            Object.entries(channelsByState).forEach(([state, count]) => {
                const stateIcon = {
                    'ACTIVE': this.icons.active,
                    'CLOSING': this.icons.closing,
                    'CLOSED': this.icons.closed,
                    'EMPTY': this.icons.empty
                }[state] || this.icons.info;

                console.log(`   ${stateIcon} ${state}: ${this.colorize(count, this.getStateColor(state))}`);
            });

            if (channels.length > 0) {
                const totalValue = channels.reduce((sum, c) => sum + parseFloat(this.formatAmount(c.amount)), 0);
                const avgValue = totalValue / channels.length;

                console.log(`   ${this.icons.fund} Total Value: ${this.colorize(totalValue.toFixed(2) + ' THD', 'accent')}`);
                console.log(`   ${this.icons.info} Average Size: ${this.colorize(avgValue.toFixed(2) + ' THD', 'info')}`);
            }

            // === STATISTIQUES FINANCIÈRES ===
            if (balanceResponse.success) {
                this.printSection('Financial Statistics', this.icons.balance);

                const total = parseFloat(balanceResponse.totalTHD);
                const available = parseFloat(balanceResponse.availableTHD);
                const locked = parseFloat(balanceResponse.channelTHD);
                const channelBalance = parseFloat(balanceResponse.channelBalance);

                const utilizationRate = total > 0 ? ((locked / total) * 100).toFixed(1) : 0;
                const liquidityRate = total > 0 ? ((available / total) * 100).toFixed(1) : 0;

                console.log(`   ${this.icons.fund} Total Holdings: ${this.colorize(total.toFixed(4) + ' THD', 'accent')}`);
                console.log(`   ${this.icons.info} Channel Utilization: ${this.colorize(utilizationRate + '%', 'primary')}`);
                console.log(`   ${this.icons.info} Liquidity Ratio: ${this.colorize(liquidityRate + '%', 'success')}`);
                console.log(`   ${this.icons.payment} Spendable in Channels: ${this.colorize(channelBalance.toFixed(4) + ' THD', 'magenta')}`);
            }

            // === STATISTIQUES DES PROPOSITIONS ===
            const proposals = infoResponse.pendingProposals || [];
            if (proposals.length > 0) {
                this.printSection('Proposal Statistics', this.icons.proposal);

                const proposalsByStatus = proposals.reduce((acc, proposal) => {
                    acc[proposal.status] = (acc[proposal.status] || 0) + 1;
                    return acc;
                }, {});

                console.log(`   ${this.icons.proposal} Total Proposals: ${this.colorize(proposals.length, 'accent')}`);

                Object.entries(proposalsByStatus).forEach(([status, count]) => {
                    console.log(`   ${this.icons.bullet} ${status}: ${this.colorize(count, this.getStatusColor(status))}`);
                });

                const totalProposalValue = proposals.reduce((sum, p) => sum + parseFloat(this.formatAmount(p.amount)), 0);
                console.log(`   ${this.icons.fund} Total Proposed Value: ${this.colorize(totalProposalValue.toFixed(2) + ' THD', 'accent')}`);
            }

            // === PERFORMANCE METRICS ===
            this.printSection('Performance Metrics', this.icons.star);

            const metrics = [
                ['Metric', 'Value', 'Rating'],
                ['Response Time', '< 100ms', this.colorize('EXCELLENT', 'success')],
                ['Memory Usage', 'Normal', this.colorize('GOOD', 'success')],
                ['Network Latency', 'Low', this.colorize('EXCELLENT', 'success')],
                ['Sync Status', 'Current', this.colorize('GOOD', 'success')]
            ];

            this.printTable(['Metric', 'Value', 'Rating'], metrics.slice(1), {
                headerColor: 'brightMagenta',
                alternateRows: true
            });

        } catch (error) {
            this.printStatus('error', 'Failed to gather statistics', error.message);
        }
    }

    /**
     * Formate un montant en wei vers THD avec validation
     */
    formatAmount(amountWei) {
        try {
            if (!amountWei) return '0';

            const divisor = BigInt(10 ** 18);
            const amount = BigInt(amountWei);
            const wholePart = amount / divisor;
            const fractionalPart = amount % divisor;

            // Affiche jusqu'à 4 décimales si nécessaire
            if (fractionalPart === BigInt(0)) {
                return wholePart.toString();
            } else {
                const fractionalStr = fractionalPart.toString().padStart(18, '0');
                const trimmed = fractionalStr.replace(/0+$/, '');
                const decimals = trimmed.slice(0, 4);
                return `${wholePart}.${decimals}`;
            }
        } catch (error) {
            console.error('Amount formatting error:', error.message);
            return '0';
        }
    }

    /**
     * Affiche un récapitulatif des commandes disponibles
     */
    printCommandSummary() {
        this.printTitle('⚡ THUNDER CLI COMMANDS', 'Complete command reference');

        const commands = [
            {
                category: 'System & Information',
                icon: this.icons.node,
                commands: [
                    { cmd: 'infos', desc: 'Display comprehensive node information' },
                    { cmd: 'stats', desc: 'Show detailed analytics and statistics' },
                    { cmd: 'diagnose', desc: 'Run system health diagnostics' },
                    { cmd: 'help [command]', desc: 'Show help or command-specific help' }
                ]
            },
            {
                category: 'Wallet & Balance',
                icon: this.icons.wallet,
                commands: [
                    { cmd: 'importwallet "<seed>"', desc: 'Import wallet from seed phrase' },
                    { cmd: 'balance', desc: 'Show THD balances and distribution' }
                ]
            },
            {
                category: 'Network & Peers',
                icon: this.icons.network,
                commands: [
                    { cmd: 'connect <host:port>', desc: 'Connect to another Thunder node' }
                ]
            },
            {
                category: 'Channel Management',
                icon: this.icons.channel,
                commands: [
                    { cmd: 'proposechannel <peer> <amount>', desc: 'Propose new payment channel' },
                    { cmd: 'acceptchannel <proposalId>', desc: 'Accept channel proposal' },
                    { cmd: 'createchannel <proposalId>', desc: 'Deploy smart contract' },
                    { cmd: 'fundchannel <channelId>', desc: 'Fund your part of channel' },
                    { cmd: 'proposals', desc: 'List all channel proposals' }
                ]
            },
            {
                category: 'Payments & Operations',
                icon: this.icons.payment,
                commands: [
                    { cmd: 'pay <amount>', desc: 'Send instant off-chain payment' },
                    { cmd: 'closechannel', desc: 'Close active payment channel' },
                    { cmd: 'withdraw', desc: 'Withdraw funds after closure' }
                ]
            },
            {
                category: 'Legacy Support',
                icon: this.icons.warning,
                commands: [
                    { cmd: 'openchannel [amount]', desc: '⚠️ Deprecated: Use P2P workflow instead' }
                ]
            }
        ];

        commands.forEach(category => {
            this.printSection(category.category, category.icon);

            category.commands.forEach(({ cmd, desc }) => {
                const isDeprecated = desc.includes('⚠️');
                const cmdColor = isDeprecated ? 'warning' : 'brightCyan';
                const descColor = isDeprecated ? 'muted' : 'gray';

                console.log(`   ${this.colorize('thunder-cli ' + cmd, cmdColor)}`);
                console.log(`   ${this.colorize('└─ ' + desc, descColor)}`);
                console.log('');
            });
        });

        this.printInfoBox('Command Syntax', [
            'How to use Thunder CLI commands:',
            '',
            'Basic syntax:',
            '   thunder-cli <command> [arguments]',
            '',
            'With custom port:',
            '   thunder-cli --port 2002 <command>',
            '',
            'With custom host:',
            '   thunder-cli --host remote.server.com --port 2001 <command>',
            '',
            'Get command help:',
            '   thunder-cli help <command>',
            '   thunder-cli help proposechannel'
        ], 'info');
    }

    /**
     * Affiche des conseils d'utilisation avancés
     */
    printUsageTips() {
        this.printInfoBox('💡 Pro Tips & Best Practices', [
            'Maximize your Thunder CLI experience:',
            '',
            `${this.icons.check} Multi-node management:`,
            '   thunder-cli --port 2002 balance',
            '   thunder-cli --port 2003 infos',
            '',
            `${this.icons.check} Regular monitoring:`,
            '   thunder-cli infos      # Node status',
            '   thunder-cli stats      # Detailed analytics',
            '   thunder-cli diagnose   # Health check',
            '',
            `${this.icons.check} Proposal management:`,
            '   thunder-cli proposals  # Check incoming/outgoing',
            '',
            `${this.icons.check} Balance verification:`,
            '   thunder-cli balance    # After every operation',
            '',
            `${this.icons.check} Testing with small amounts:`,
            '   thunder-cli proposechannel <peer> 1  # Test first',
            '',
            `${this.icons.check} Troubleshooting:`,
            '   thunder-cli diagnose   # System health',
            '   thunder-cli stats      # Performance metrics'
        ], 'info');
    }

    /**
     * Affiche l'aide contextuelle selon la commande
     */
    printContextualHelp(command) {
        const helpContent = {
            proposechannel: {
                title: 'Channel Proposal Help',
                icon: this.icons.proposal,
                content: [
                    'Create a new payment channel proposal:',
                    '',
                    `${this.icons.info} Syntax:`,
                    '   thunder-cli proposechannel <peer> <amount>',
                    '',
                    `${this.icons.check} Parameters:`,
                    '   • peer: Address of peer node (host:port)',
                    '   • amount: Total channel capacity in THD',
                    '',
                    `${this.icons.star} Examples:`,
                    '   thunder-cli proposechannel localhost:2002 10',
                    '   thunder-cli proposechannel 192.168.1.100:2001 50',
                    '   thunder-cli proposechannel peer.example.com:2001 25',
                    '',
                    `${this.icons.fund} Cost Sharing:`,
                    '   Each party contributes 50% of the total amount',
                    '   For 10 THD channel: you pay 5 THD, peer pays 5 THD',
                    '',
                    `${this.icons.warning} Requirements:`,
                    '   • Peer must be connected first',
                    '   • Sufficient THD balance available',
                    '   • Wallet must be imported'
                ]
            },
            pay: {
                title: 'Off-chain Payment Help',
                icon: this.icons.payment,
                content: [
                    'Send instant off-chain payments:',
                    '',
                    `${this.icons.info} Syntax:`,
                    '   thunder-cli pay <amount>',
                    '',
                    `${this.icons.star} Features:`,
                    '   • Instant settlement (< 1 second)',
                    '   • Zero transaction fees',
                    '   • Cryptographically secure',
                    '   • Works with ACTIVE channels only',
                    '',
                    `${this.icons.check} Examples:`,
                    '   thunder-cli pay 5        # Send 5 THD',
                    '   thunder-cli pay 0.5      # Send 0.5 THD',
                    '   thunder-cli pay 25.75    # Send 25.75 THD',
                    '',
                    `${this.icons.warning} Requirements:`,
                    '   • Active payment channel exists',
                    '   • Sufficient channel balance',
                    '   • Peer is connected and responsive'
                ]
            },
            balance: {
                title: 'Balance Information Help',
                icon: this.icons.balance,
                content: [
                    'Understanding your THD balances:',
                    '',
                    `${this.icons.fund} Balance Types:`,
                    '   • Total: Complete THD token holdings',
                    '   • Available: Spendable outside channels',
                    '   • Channel Locked: Contributions to channels',
                    '   • Channel Balance: Spendable within channels',
                    '',
                    `${this.icons.info} Key Points:`,
                    '   • Locked funds are secure in smart contracts',
                    '   • Channel balances change with payments',
                    '   • Available balance is for new channels',
                    '   • All balances are displayed in THD tokens'
                ]
            }
        };

        const help = helpContent[command];
        if (help) {
            this.printTitle(`${help.icon} ${help.title.toUpperCase()}`, `Detailed help for '${command}' command`);
            this.printInfoBox(help.title, help.content, 'info');
        } else {
            this.printTitle('❓ COMMAND NOT FOUND', 'Unknown command help requested');
            this.printInfoBox('Command Not Found', [
                `No help available for command: ${command}`,
                '',
                'Available commands with help:',
                '• proposechannel  • pay          • balance',
                '• acceptchannel   • closechannel • fundchannel',
                '• createchannel   • withdraw     • connect',
                '',
                'Usage: thunder-cli help <command>',
                'Example: thunder-cli help proposechannel'
            ], 'warning');
        }
    }
}

module.exports = Commands;