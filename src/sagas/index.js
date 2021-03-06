import {takeLatest} from 'redux-saga'
import {call, apply, put, take, select} from 'redux-saga/effects'
import {OrderedSet} from 'immutable'

import {makeId, getDiffId} from '../utils'
import DB from '../db'
import {eachInline} from './utils'

import { changePage } from './pagination'

let mutateIndex = 0

function* loadModelView( action ) {
  try {
    const { schema, name, query, props } = action.payload
    yield put( { type: 'MODEL_LOAD_VIEW_REQUEST', payload: { name } } )

    // Load the DB from the state.
    const state = yield select()
    let db = schema.db( state.model.db )

    // A place to put the IDs of our loaded objects.
    let results = {}

    // A place to store extra data about our results.
    // TODO: This should probably live in the data itself? Maybe?
    let meta = {}

    // A place to hold the JSON responses to be loaded.
    let jsonData = []
    
    // Process each named query. We want to load the data, cache it
    // in results, then update the store immediately.
    for( const name of Object.keys( query ) ) {
      console.debug( `loadModelView: Looking up ${name}.` )
      const data = yield call( query[name], props )
      if( data !== null ) {
        jsonData.push( data )
      }
      if( data ) {
        if( Array.isArray( data.data ) ) {

          // First, convert the results into an array of IDs.
          results[name] = data.data.map( x => makeId( x.type, x.id ) )

          // Store any links and pagination information.
          meta[name] = {
            ...(data.meta || {})
          }
          if( data.links ) {
            meta[name].links = data.links
          }
        }
        else {
          results[name] = makeId( data.data.type, data.data.id )
        }
      }
      else
        results[name] = null
    }

    // TODO: I don't think I need this. Clearing can be nice to keep things
    // clean, but it precludes the possibility of having different components
    // use DBComponent.
    // // Clear the database prior to loading data. We don't need to
    // // wait for it because we'll be waiting for the next put.
    // yield put( {type: 'MODEL_CLEAR', payload: {schema}} )

    // Merge in the loaded data and wait for it to be finished.
    yield put( {type: 'MODEL_LOAD_JSON', payload: {schema, jsonData}} )
    yield take(
      action => {
        return (
          action.type == 'MODEL_LOAD_JSON_DONE'
          && action.payload
          && action.payload.jsonData == jsonData
        )
      }
    )

    yield put( {type: 'MODEL_LOAD_VIEW_SUCCESS', payload: {name, results, meta}} )
  }
  catch( e ) {
    console.error( e )
    yield put( {type: 'MODEL_LOAD_VIEW_FAILURE', errors: e.message} )
  }
}

/**
 * Synchronise the current DB against the server.
 */
function* sync( action ) {
  console.debug( 'Model: Sync.' )
  const {schema} = action.payload
  try {
    yield put( {type: 'MODEL_SYNC_REQUEST'} )
    // yield put( {type: 'MODEL_COMMIT', payload: {schema}} )
    /* yield commit( {schema} )*/
    while( 1 ) {
      let state = yield select()
      let db = schema.db( state.model.db )
      let response = yield call( [db, db.commitDiff] )
      if( !response ) {
        break
      }

      // I'll be the only one sending post commit diffs, so I can wait for
      // it to finish in here. If I don't wait for the post commit diff to
      // be done, we continue on and pick up the same diff again.
      yield put( {type: 'MODEL_POST_COMMIT_DIFF', payload: {schema, response}} )
      yield take( 'MODEL_POST_COMMIT_DIFF_DONE' )
    }
    yield put( {type: 'MODEL_SYNC_SUCCESS'} )
  }
  catch( e ) {
    console.error( e )
    yield put( {type: 'MODEL_SYNC_FAILURE', errors: e.message} )
  }
}

/**
 * Mutate a DB by applying a mutation function
 *
 * Each mutation retrieves the current state of the DB from the redux store, runs
 * the mutation on the state, then calls a reducer to set the new state.
 */
export function* mutate( schema, mutation ) {
  let state = yield select()
  let db = schema.db( state.model.db )
  mutation( db )
  yield put( {type: 'MODEL_SET_DB_DATA', payload: db.data} )
}

/**
 * Mutate a DB by saving a transaction
 *
 * Saving a transaction is different to committing in that saving only caches the
 * current state of a transaction to the redux store. Committing merges the
 * transaction into the main DB.
 */
export function* startTransaction( payload ) {
  yield call(
    mutate,
    payload.schema,
    db =>
      db.startTransaction( payload.name )
  )
}

/**
 * TODO
 */
export function* saveTransaction( payload ) {
  yield call(
    mutate,
    payload.schema,
    db =>
      db.saveTransaction( payload.db )
  )
}

/**
 * Mutate a DB by aborting a transaction
 */
export function* abortTransaction( payload ) {
  yield call(
    mutate,
    payload.schema,
    db =>
      db.abortTransaction( payload.name )
  )
}

/**
 * Mutate a DB by committing a transaction
 */
export function* commitTransaction( payload ) {
  yield call(
    mutate,
    payload.schema,
    db =>
      db.commitTransaction( payload.name )
  )
}

/**
 * TODO
 */
function* commit( payload ) {
  yield call(
    mutate,
    payload.schema,
    db =>
      db.commit()
  )
}

/**
 * Mutate a DB by performing post-commit operations
 */
function* postCommitDiff( payload ) {
  yield call(
    mutate,
    payload.schema,
    db =>
      db.postCommitDiff( payload.response )
  )
  yield put( {type: 'MODEL_POST_COMMIT_DIFF_DONE', payload} )
}

/**
 * Mutate a DB by loading data returned in JSONAPI
 */
function* loadJson( payload ) {
  yield call(
    mutate,
    payload.schema,
    db => {
      for( const data of payload.jsonData ) {

        // TODO: For some reason exceptions don't get propagated
        // from within this call. No idea why...
        db.loadJsonApi( data )
      }
    }
  )
  yield put( {type: 'MODEL_LOAD_JSON_DONE', payload} )
}

/**
 * Mutate a DB by clearing.
 */
function* clear( payload ) {
  yield call(
    mutate,
    payload.schema,
    db =>
      db.clear()
  )
}

/**
 * Serialize DB mutations
 *
 * Using immutable data-structures in combination with sagas and latency from
 * async operations can cause an interesting situation whereby updates to the
 * DB are stomped on from other areas of the code. We need to ensure all write
 * operations occur in a strictly linear fashion, and only on the same, consistent
 * view of the DB.
 */
export function* mutationSerializer( action ) {
  switch( action.type ) {
    case 'MODEL_START_TRANSACTION':
      yield call( startTransaction, action.payload )
      break
    case 'MODEL_SAVE_TRANSACTION':
      yield call( saveTransaction, action.payload )
      break
    case 'MODEL_ABORT_TRANSACTION':
      yield call( abortTransaction, action.payload )
      break
    case 'MODEL_COMMIT_TRANSACTION':
      yield call( commitTransaction, action.payload )
      break
    case 'MODEL_COMMIT':
      yield call( commit, action.payload )
      break
    case 'MODEL_POST_COMMIT_DIFF':
      yield call( postCommitDiff, action.payload )
      break
    case 'MODEL_LOAD_JSON':
      yield call( loadJson, action.payload )
      break
    case 'MODEL_CLEAR':
      yield call( clear, action.payload )
      break
  }
}

/**
 * The composed model saga
 */
export default function* modelSaga() {
  try {
    yield [
      eachInline( 'MODEL_LOAD_VIEW', loadModelView ),
      eachInline(
        [
          'MODEL_NEXT_PAGE',
          'MODEL_PREV_PAGE',
          'MODEL_FIRST_PAGE',
          'MODEL_LAST_PAGE'
        ],
        changePage
      ),
      eachInline( 'MODEL_SYNC', sync ),
      eachInline(
        [
          'MODEL_START_TRANSACTION',
          'MODEL_SAVE_TRANSACTION',
          'MODEL_ABORT_TRANSACTION',
          'MODEL_COMMIT_TRANSACTION',
          'MODEL_COMMIT',
          'MODEL_POST_COMMIT_DIFF',
          'MODEL_LOAD_JSON',
          'MODEL_CLEAR'
        ],
        mutationSerializer
      )
    ]
  }
  catch( e ) {
    console.error( 'Uncaught exception in redux-jam:' )
    console.error( e )
  }
}
