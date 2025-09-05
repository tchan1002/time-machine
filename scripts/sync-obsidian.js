#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import { copyFile, mkdir, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

const ROOT_DIR = path.resolve(__dirname, '..');
const OBSIDIAN_REPO_URL = 'https://github.com/tchan1002/obsidian.git';
const TEMP_DIR = path.join(ROOT_DIR, 'temp-obsidian');
const ENTRIES_DIR = path.join(ROOT_DIR, 'entries');
const OBSIDIAN_ENTRIES_PATH = path.join(TEMP_DIR, 'Obsidian Vault', '100 Days');

async function syncFromObsidian() {
  try {
    console.log('🔄 Syncing from Obsidian repo...');
    console.log(`📁 Source: ${OBSIDIAN_ENTRIES_PATH}`);
    console.log(`📁 Destination: ${ENTRIES_DIR}`);
    
    // Clone or pull latest
    try {
      await execAsync(`git clone ${OBSIDIAN_REPO_URL} "${TEMP_DIR}"`);
      console.log('✅ Cloned Obsidian repo');
    } catch (error) {
      // If already exists, pull latest
      console.log('📥 Pulling latest changes...');
      await execAsync(`cd "${TEMP_DIR}" && git pull`);
      console.log('✅ Updated Obsidian repo');
    }
    
    // Ensure entries directory exists
    await mkdir(ENTRIES_DIR, { recursive: true });
    
    // Copy journal entries from 100 Days folder
    const files = await readdir(OBSIDIAN_ENTRIES_PATH);
    const mdFiles = files.filter(f => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    
    console.log(`📋 Found ${mdFiles.length} journal entries in 100 Days folder`);
    
    for (const file of mdFiles) {
      const srcPath = path.join(OBSIDIAN_ENTRIES_PATH, file);
      const destPath = path.join(ENTRIES_DIR, file);
      await copyFile(srcPath, destPath);
      console.log(`📝 Synced: ${file}`);
    }
    
    // Build site
    console.log('🔨 Building site...');
    await execAsync('npm run build', { cwd: ROOT_DIR });
    console.log('✅ Site built successfully');
    
    // Deploy
    console.log('🚀 Deploying to GitHub Pages...');
    await execAsync('npm run deploy', { cwd: ROOT_DIR });
    console.log('✅ Deployed successfully');
    
    // Cleanup
    await execAsync(`rm -rf "${TEMP_DIR}"`);
    console.log('🧹 Cleaned up temporary files');
    
    console.log('🎉 Sync complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

syncFromObsidian();
