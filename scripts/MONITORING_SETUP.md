# API Token Monitoring Setup

This setup allows the AI assistant to automatically monitor your SonarCloud and DeepSource quality metrics.

## 🔐 Security Architecture

- Tokens are stored in `~/.config/opencode/.secrets` with **600 permissions** (only owner can read)
- Tokens are **never** committed to the repository
- Tokens are **never** shared in chat conversations
- Tokens are loaded automatically in new shell sessions

## 📁 File Structure

```
~/.config/opencode/
└── .secrets              # API tokens (600 permissions, never commit)

/home/verge/projects/opencode-mem0/
└── scripts/
    └── monitor-quality.sh # Monitoring script
```

## 🚀 Setup Instructions

### Step 1: Rotate Your Compromised Tokens (CRITICAL!)

**Both previous tokens were exposed in chat and must be rotated immediately.**

**SonarCloud:**

1. Go to https://sonarcloud.io
2. Click **Avatar → My Account → Security**
3. Find and **revoke** the old token ending in `...b1eb`
4. Click **Generate Token**
   - Name: `opencode-ai-monitor`
   - Type: User token
   - Expiration: No expiration (or 1 year)
5. **Copy the token immediately** (you can't see it again)

**DeepSource:**

1. Go to https://deepsource.io
2. Navigate to your **opencode-mem0** repository
3. Click **Settings → API Access**
4. Find and **revoke** the old token `dsp_805e0ef8...`
5. Generate a **new API key** named `opencode-ai-monitor`
6. **Copy the token immediately**

### Step 2: Store Your New Tokens

Open the secrets file:

```bash
nano ~/.config/opencode/.secrets
```

Replace the placeholder values:

```bash
# Line 18: Replace YOUR_SONARCLOUD_TOKEN_HERE with your new SonarCloud token
export SONAR_TOKEN="your_actual_sonarcloud_token_here"

# Line 23: Replace YOUR_DEEPSOURCE_TOKEN_HERE with your new DeepSource token
export DEEPSOURCE_TOKEN="your_actual_deepsource_token_here"
```

Save and exit (Ctrl+O, Enter, Ctrl+X).

### Step 3: Verify Setup

Run the monitoring script:

```bash
./scripts/monitor-quality.sh
```

You should see live metrics from both services.

### Step 4: Enable Automatic Loading

The secrets file is already configured to auto-load in new shell sessions (added to `~/.bashrc`).

To verify:

```bash
source ~/.bashrc
echo $SONAR_TOKEN | head -c 10
echo $DEEPSOURCE_TOKEN | head -c 10
```

## 📊 What Gets Monitored

**SonarCloud:**

- Quality gate status (pass/fail)
- Code coverage percentage
- Bugs, vulnerabilities, code smells
- Duplication rate
- Cognitive complexity
- Security hotspots

**DeepSource:**

- Analysis run status
- Issue counts by category
- Code quality trends

## 🔄 Usage

### Manual Check

```bash
./scripts/monitor-quality.sh
```

### Daily Monitoring (Cron)

Add to your crontab:

```bash
0 9 * * * cd /home/verge/projects/opencode-mem0 && ./scripts/monitor-quality.sh >> /tmp/quality-monitor.log 2>&1
```

### AI Assistant Check

When you start a session, the AI can run:

```bash
source ~/.config/opencode/.secrets
./scripts/monitor-quality.sh
```

## 🛡️ Security Checklist

- [ ] Old SonarCloud token revoked
- [ ] Old DeepSource token revoked
- [ ] New tokens stored in `~/.config/opencode/.secrets`
- [ ] File permissions are 600 (`ls -la ~/.config/opencode/.secrets`)
- [ ] Tokens never shared in chat/email
- [ ] Tokens not in shell history
- [ ] `.secrets` file is in `.gitignore` (automatic)

## 🆘 Troubleshooting

**Script says "token not configured":**

- Check that you replaced the placeholder text in `~/.config/opencode/.secrets`
- Run `source ~/.bashrc` to reload environment
- Verify with `echo $SONAR_TOKEN | head -c 10`

**401 Unauthorized errors:**

- Token may be revoked or expired
- Generate a new token and update the `.secrets` file

**No metrics shown:**

- Project may not be analyzed yet
- Check SonarCloud/DeepSource dashboards directly

## 📞 Support

If you need to regenerate tokens:

- SonarCloud: https://sonarcloud.io/account/security
- DeepSource: https://deepsource.io/settings/api-access

---

**Remember: Never share tokens in chat, email, or commit them to git!**
