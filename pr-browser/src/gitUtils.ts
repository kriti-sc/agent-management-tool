import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export function slugify(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

export async function isDirty(cwd: string): Promise<boolean> {
    const { stdout } = await execAsync('git status --porcelain', { cwd });
    return stdout.trim().length > 0;
}

export async function checkoutBranch(branch: string, cwd: string): Promise<void> {
    await execAsync(`git checkout ${branch}`, { cwd });
    await execAsync('git pull', { cwd });
}

export async function createCommentBranch(branch: string, cwd: string): Promise<void> {
    try {
        await execAsync(`git checkout -b ${branch}`, { cwd });
    } catch {
        // Branch already exists — just switch to it
        await execAsync(`git checkout ${branch}`, { cwd });
    }
}
