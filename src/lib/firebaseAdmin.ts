import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
    return JSON.parse(json) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
  }

  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ??
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin 尚未設定，請填入 service account 環境變數。");
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey
  };
}

export function getAdminDb() {
  if (!getApps().length) {
    const serviceAccount = getServiceAccount();
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

    initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key
      }),
      ...(storageBucket ? { storageBucket } : {})
    });
  }

  return getFirestore();
}

export function getAdminStorageBucket() {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  if (!bucketName) {
    throw new Error("Firebase Storage bucket 尚未設定。");
  }

  if (!getApps().length) {
    getAdminDb();
  }

  return getStorage().bucket(bucketName);
}

export async function getAdminAuth() {
  if (!getApps().length) {
    getAdminDb();
  }

  const { getAuth } = await import("firebase-admin/auth");
  return getAuth();
}
