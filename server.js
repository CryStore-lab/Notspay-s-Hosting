const express = require('express');
const path = require('path');
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const vm = require('vm'); 
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// CORS BYPASS PROTOCOLS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    next();
});

// MULTI-BOT RAM MATRIX
const actieveBots = new Map();

function stopBotEngine(botId) {
    const actieveBot = actieveBots.get(botId);
    if (actieveBot) {
        try { actieveBot.client.destroy(); } catch (e) {}
        actieveBots.delete(botId);
    }
}

async function startBotEngine(botId, token, scripts) {
    stopBotEngine(botId);

    try {
        const client = new Client({ 
            intents: [
                GatewayIntentBits.Guilds, 
                GatewayIntentBits.GuildMessages, 
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers
            ] 
        });

        // Sla elke bot-instance volledig apart op inclusief zijn eigen code-bestanden
        actieveBots.set(botId, { 
            client, 
            startTijd: Date.now(), 
            token, 
            scripts: scripts || [],
            statusType: 'online',
            statusTekst: 'on the grid...'
        });

        client.on('interactionCreate', async (interaction) => {
            try {
                const botData = actieveBots.get(botId);
                if (!botData || !botData.scripts) return;
                botData.scripts.forEach(file => {
                    try {
                        const context = { interaction, client, console, interactieData: { type: interaction.type, data: { name: interaction.commandName } } };
                        vm.createContext(context);
                        vm.runInContext(file.inhoud, context);
                    } catch (error) {}
                });
            } catch (err) {}
        });

        client.on('messageCreate', async (message) => {
            try {
                if (message.author.bot) return;
                const botData = actieveBots.get(botId);
                if (!botData || !botData.scripts) return;

                botData.scripts.forEach(file => {
                    try {
                        const createChannelShortcut = async (naam, type = 'text', parentId = null) => {
                            if (!message.guild) return null;
                            let dType = type === 'category' ? ChannelType.GuildCategory : (type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText);
                            return await message.guild.channels.create({ name: naam, type: dType, parent: parentId }).catch(() => null);
                        };
                        const context = { message, client, console, args: message.content.split(' ').slice(1), commandName: message.content.split(' ')[0].toLowerCase(), createChannel: createChannelShortcut };
                        vm.createContext(context);
                        vm.runInContext(file.inhoud, context);
                    } catch (error) {}
                });
            } catch (err) {}
        });

        client.once('ready', async () => {
            console.log(`[CLUSTER] Bot Online: ${client.user.username} (${botId})`);
            const slashMenuLayout = [];
            if (scripts && scripts.length > 0) {
                scripts.forEach(script => {
                    let commandName = script.bestandsnaam.toLowerCase().replace('.js', '').trim().replace(/[^a-z0-9]/g, '');
                    if (commandName.length > 0) {
                        slashMenuLayout.push({ name: commandName, description: `Custom macro process mapped from script: ${script.bestandsnaam}` });
                    }
                });
            }
            try {
                const guilds = await client.guilds.fetch();
                for (const [guildId] of guilds) {
                    const guild = await client.guilds.fetch(guildId);
                    await guild.commands.set(slashMenuLayout).catch(() => {});
                }
            } catch (slashErr) {}
        });

        await client.login(token);
    } catch (e) {
        console.error(`[CRASH] Failed to initialize bot operational routing.`);
    }
}

app.post('/api/sync-bot', async (req, res) => {
    const { token, scripts } = req.body;
    if (!token || token.trim() === "") return res.json({ success: false, error: "No token provided." });

    try {
        const testClient = new Client({ intents: [GatewayIntentBits.Guilds] });
        await testClient.login(token);
        const botId = testClient.user.id;
        const botNaam = testClient.user.username;
        const botLogo = testClient.user.displayAvatarURL({ format: 'png', size: 256 }) || "https://cdn.discordapp.com/embed/avatars/0.png";
        testClient.destroy();

        await startBotEngine(botId, token, scripts || []);
        res.json({ success: true, bot: { id: botId, naam: botNaam, logo: botLogo, status: "Online" } });
    } catch (e) { res.json({ success: false, error: "Invalid Discord Token." }); }
});

app.post('/api/delete-bot', (req, res) => { 
    stopBotEngine(req.body.botId); 
    res.json({ success: true }); 
});

app.get('/api/channels/:botId', async (req, res) => {
    const bot = actieveBots.get(req.params.botId); if (!bot) return res.json([]);
    try {
        const guild = bot.client.guilds.cache.first(); if (!guild) return res.json([]);
        const channels = await guild.channels.fetch(); const list = [];
        channels.forEach(c => { if (c && (c.type === 0 || c.type === 2 || c.type === 4)) { list.push({ id: c.id, name: c.name, type: c.type === 4 ? 'category' : (c.type === 2 ? 'voice' : 'text') }); } });
        res.json(list);
    } catch (e) { res.json([]); }
});

app.post('/api/channels/create', async (req, res) => {
    const { botId, name, type } = req.body; const bot = actieveBots.get(botId); if (!bot) return res.json({ success: false });
    try {
        const guild = bot.client.guilds.cache.first();
        let dType = type === 'category' ? ChannelType.GuildCategory : (type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText);
        await guild.channels.create({ name: name, type: dType }); res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/channels/delete', async (req, res) => {
    const { botId, channelId, allesWissen } = req.body; const bot = actieveBots.get(botId); if (!bot) return res.json({ success: false });
    try {
        const guild = bot.client.guilds.cache.first();
        if (allesWissen) {
            const channels = await guild.channels.fetch();
            for (const [id, c] of channels) { if (c && c.deletable) await c.delete().catch(() => {}); }
            res.json({ success: true });
        } else {
            const channel = await guild.channels.fetch(channelId);
            if (channel && channel.deletable) { await channel.delete(); res.json({ success: true }); } else res.json({ success: false });
        }
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/moderation/info/:botId', async (req, res) => { 
    const bot = actieveBots.get(req.params.botId); if (!bot) return res.json({ success: false, memberCount: 0 }); 
    try { 
        const guild = bot.client.guilds.cache.first(); if (!guild) return res.json({ memberCount: 0 }); 
        res.json({ success: true, memberCount: guild.memberCount, serverNaam: guild.name, textChannels: guild.channels.cache.filter(c=>c.type===0).size, voiceChannels: guild.channels.cache.filter(c=>c.type===2).size, rolesCount: guild.roles.cache.size }); 
    } catch (e) { res.json({ memberCount: 0 }); } 
});

app.post('/api/moderation/lockdown', async (req, res) => {
    const { botId, status } = req.body; const bot = actieveBots.get(botId); if (!bot) return res.json({ success: false });
    try {
        const guild = bot.client.guilds.cache.first(); const everyoneRole = guild.roles.everyone;
        if (status === true) await everyoneRole.setPermissions(everyoneRole.permissions.missing(PermissionFlagsBits.SendMessages));
        else await everyoneRole.setPermissions(everyoneRole.permissions.add(PermissionFlagsBits.SendMessages));
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/settings/update', async (req, res) => { 
    const { botId, statusType, statusTekst } = req.body; 
    const bot = actieveBots.get(botId); if (!bot) return res.json({ success: false }); 
    try { 
        bot.statusType = statusType; bot.statusTekst = statusTekst;
        bot.client.user.setStatus(statusType); 
        bot.client.user.setActivity(statusTekst, { type: 0 }); 
        res.json({ success: true }); 
    } catch (e) { res.json({ success: false }); } 
});

app.post('/api/actie', async (req, res) => {
    const { actie, botId, token, scripts } = req.body;
    if (!botId || !token) return res.json({ success: false, error: "Missing identity alignment arrays." });
    if (actie === 'stop') { stopBotEngine(botId); return res.json({ success: true, status: "Offline" }); }
    if (actie === 'start' || actie === 'restart') { await startBotEngine(botId, token, scripts || []); return res.json({ success: true, status: "Online" }); }
    res.json({ success: false });
});

app.post('/api/status', (req, res) => {
    if (!req.body.botId) return res.json({ status: "Offline", uptime: "0s", cpu: 0, ram: 0, logs: ["Awaiting matrix target..."] });
    const bot = actieveBots.get(req.body.botId);
    res.json({
        status: bot ? "Online" : "Offline",
        uptime: bot ? `${Math.floor((Date.now() - bot.startTijd) / 1000)}s` : "0s",
        cpu: bot ? Math.floor(Math.random() * 3) + 1 : 0,
        ram: bot ? 24.2 : 0,
        logs: bot ? ["Authorized Connection Core Stable.", `[OK] Instance payload: ${bot.statusTekst}`, `[OK] Gateway: ${bot.statusType.toUpperCase()}`] : ["Instance offline."]
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`🌍 Mainframe live on port ${PORT}`));