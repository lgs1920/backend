/**********************************************************************************************************************
 *                                                                                                                    *
 * This file is part of the LGS1920/backend project.                                                                  *
 *                                                                                                                    *
 * File: corsMiddleware.js                                                                                            *
 *                                                                                                                    *
 * Author : LGS1920 Team                                                                                              *
 * email: contact@lgs1920.fr                                                                                          *
 *                                                                                                                    *
 * Created on: 2025-07-29                                                                                             *
 * Last modified: 2025-07-29                                                                                          *
 *                                                                                                                    *
 *                                                                                                                    *
 * Copyright © 2025 LGS1920                                                                                           *
 **********************************************************************************************************************/

import { Elysia } from 'elysia';

export const corsPlugin = ({ allowedDomains = ['lgs1920.fr'], backendConfig } = {}) =>
    new Elysia({ name: 'cors-plugin' })
        .onRequest(({ request, set }) => {
            const origin = request.headers.get('origin');
            const url = new URL(request.url);

            console.log('CORS - Method:', request.method, 'Origin:', origin, 'Path:', url.pathname);

            const corsHeaders = {
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
            };

            // Gestion des requêtes OPTIONS (preflight)
            if (request.method === 'OPTIONS') {
                console.log('OPTIONS detected - setting CORS headers');
                
                set.status = 204;
                set.headers = {
                    'Access-Control-Allow-Origin': origin || '*',
                    ...corsHeaders,
                };
                
                // Retourner une réponse vide pour les OPTIONS
                return new Response(null, {
                    status: 204,
                    headers: {
                        'Access-Control-Allow-Origin': origin || '*',
                        ...corsHeaders,
                    }
                });
            }

            // Pour toutes les autres requêtes, appliquer les en-têtes CORS
            const isSwagger = url.pathname.startsWith('/swagger');
            
            if (isSwagger) {
                set.headers = {
                    ...set.headers,
                    'Access-Control-Allow-Origin': origin || '*',
                    ...corsHeaders,
                };
                return;
            }

            // Si pas d'origin (requêtes directes)
            if (!origin) {
                set.headers = {
                    ...set.headers,
                    'Access-Control-Allow-Origin': '*',
                    ...corsHeaders,
                };
                return;
            }

            // Vérifier si l'origin est autorisée
            const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
            const isDomainAllowed = allowedDomains.some(domain => origin.includes(domain));
            
            console.log('isLocalhost:', isLocalhost, 'isDomainAllowed:', isDomainAllowed);
            
            if (!isLocalhost && !isDomainAllowed) {
                console.warn(`[CORS] Origin rejetée : ${origin}`);
                return new Response('Forbidden origin', { status: 403 });
            }

            // Origin autorisée
            set.headers = {
                ...set.headers,
                'Access-Control-Allow-Origin': origin,
                ...corsHeaders,
            };
            
            console.log('CORS headers set for origin:', origin);
        });