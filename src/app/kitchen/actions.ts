"use server";

import { cookies } from "next/headers";
// Kein redirect Import mehr nötig!

export async function loginAction(formData: FormData) {
  
  const passwordInput = formData.get("password");
  const CORRECT_PASSWORD = "geheim123";

  console.log("--------------------------------");
  console.log("Passwort Check:", passwordInput); 
  console.log("--------------------------------");

  if (passwordInput?.toString() === CORRECT_PASSWORD) {
    // 1. Cookie setzen (Das ist der Ausweis)
    const cookieStore = await cookies();
    cookieStore.set("kitchen_auth", "true", { path: "/" });
    
    // 2. Wir geben dem Browser das Signal: "Alles gut, du kannst wechseln!"
    return { success: true };
  } else {
    return { success: false, message: "Falsches Passwort!" };
  }
}