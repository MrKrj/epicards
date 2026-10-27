import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/local-auth';
import { openBooster } from '@/lib/local-drop';
export const runtime='nodejs';
const schema=z.object({setId:z.string().min(1),free:z.boolean()});
export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:'Connexion requise.'},{status:401});
 const input=schema.safeParse(await request.json().catch(()=>null));if(!input.success)return NextResponse.json({error:'Paramètres de booster invalides.'},{status:400});
 const result=openBooster(user.id,input.data.setId,input.data.free);
 if(!result.ok)return NextResponse.json({error:result.error??'Limite de cinq boosters gratuits atteinte.',retryAt:result.retryAt,remainingPacks:0},{status:result.error?400:429});
 return NextResponse.json(result);
}
